import { z } from "zod";
import { LIBRARY_QUERIES } from "../repositories/library-queries.ts";
import type { ReadRows } from "./collection-summary.ts";
import type {
  LibraryData,
  MangaSeries,
  CdAlbum,
} from "../../domain/library.ts";

const string = z.string();
const nullable = string.nullable();
const mangaRow = z.object({
  id: string,
  acquired_on: nullable,
  notes: nullable,
  series_id: string,
  canonical_title: string,
  edition_run_id: string,
  edition_title: string,
  language: z.enum(["EN", "JP", "KR"]),
  language_basis: z.enum(["specified", "assumed", "confirmed"]),
  format: string,
  numbering_basis: z.enum(["printed", "source_record", "unknown"]),
  publisher: string,
  volume_label: string,
  volume_sort: z.number().nullable(),
});
const cdRow = z.object({
  id: string,
  acquired_on: nullable,
  notes: nullable,
  is_sample: z.union([z.literal(0), z.literal(1)]),
  album_id: string,
  title: string,
  release_id: string,
  release_date: nullable,
});
const credit = z.object({ display_name: string });
export async function libraryData(read: ReadRows): Promise<LibraryData> {
  const [manga, authors, aliases, tags, cds, artists, labels, media, tracks] =
    await Promise.all(
      Object.values(LIBRARY_QUERIES).map((query) => read(query)),
    );
  const series = new Map<string, MangaSeries>();
  for (const value of manga!) {
    const row = mangaRow.parse(value);
    let entry = series.get(row.series_id);
    if (!entry) {
      entry = {
        kind: "manga",
        id: row.series_id,
        title: row.canonical_title,
        authors: [
          ...new Set(
            authors!
              .filter((author) => author.series_id === row.series_id)
              .map((author) => credit.parse(author).display_name),
          ),
        ],
        aliases: aliases!
          .filter((alias) => alias.series_id === row.series_id)
          .map((alias) => string.parse(alias.title)),
        copies: [],
      };
      series.set(entry.id, entry);
    }
    entry.copies.push({
      id: row.id,
      editionRunId: row.edition_run_id,
      editionTitle: row.edition_title,
      publisher: row.publisher,
      language: row.language,
      languageBasis: row.language_basis,
      volume: row.volume_label,
      volumeSort: row.volume_sort,
      numberingBasis: row.numbering_basis,
      format: row.format,
      acquiredOn: row.acquired_on,
      notes: row.notes,
      tags: [
        ...new Set(
          tags!
            .filter((tag) => tag.item_id === row.id)
            .map((tag) => string.parse(tag.label)),
        ),
      ],
    });
  }
  const albums = new Map<string, CdAlbum>();
  for (const value of cds!) {
    const row = cdRow.parse(value);
    let entry = albums.get(row.release_id);
    if (!entry) {
      entry = {
        kind: "cd",
        id: row.release_id,
        title: row.title,
        releaseId: row.release_id,
        releaseDate: row.release_date,
        artists: [
          ...new Set(
            artists!
              .filter((artist) => artist.album_id === row.album_id)
              .map((artist) => credit.parse(artist).display_name),
          ),
        ],
        labels: labels!
          .filter((label) => label.release_id === row.release_id)
          .map((label) => string.parse(label.name)),
        catalogNumbers: labels!
          .filter(
            (label) =>
              label.release_id === row.release_id &&
              label.catalog_number !== null,
          )
          .map((label) => string.parse(label.catalog_number)),
        formats: [
          ...new Set(
            media!
              .filter((medium) => medium.release_id === row.release_id)
              .map((medium) => string.parse(medium.format)),
          ),
        ],
        tracks: tracks!
          .filter((track) => track.release_id === row.release_id)
          .map((track) => ({
            medium: z.number().int().parse(track.medium),
            position: z.number().int().parse(track.position),
            title: string.parse(track.title),
            durationMs: z.number().nullable().parse(track.duration_ms),
          })),
        copies: [],
      };
      albums.set(entry.id, entry);
    }
    entry.copies.push({
      id: row.id,
      acquiredOn: row.acquired_on,
      notes: row.notes,
      isSample: row.is_sample === 1,
    });
  }
  return { entries: [...series.values(), ...albums.values()] };
}
