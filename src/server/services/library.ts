import { z } from "zod";
import { LIBRARY_QUERIES } from "../repositories/library-queries.ts";
import { MEDIUMS } from "../../domain/types.ts";
import type { ReadRows } from "./collection-summary.ts";
import type {
  Artwork,
  LibraryData,
  MangaSeries,
  BookSeries,
  CdAlbum,
} from "../../domain/library.ts";

const string = z.string();
const nullable = string.nullable();
const mangaRow = z.object({
  version: z.number().int().positive(),
  cover_asset_id: nullable,
  id: string,
  acquired_on: nullable,
  notes: nullable,
  notes_private: z.union([z.literal(0), z.literal(1)]),
  haul_id: nullable,
  haul_acquired_on: nullable,
  haul_store: nullable,
  haul_store_private: z.union([z.literal(0), z.literal(1)]).nullable(),
  series_id: string,
  canonical_title: string,
  edition_run_id: string,
  edition_title: string,
  language: z.enum(["EN", "JP", "KR"]),
  language_basis: z.enum(["specified", "assumed", "confirmed"]),
  format: string,
  numbering_basis: z.enum(["printed", "source_record", "unknown"]),
  medium: z.enum(MEDIUMS),
  publisher: string,
  volume_label: string,
  book_title: string,
  volume_sort: z.number().nullable(),
  isbn13: nullable,
  date_unknown: z.union([z.literal(0), z.literal(1)]),
  cover_unavailable: z.union([z.literal(0), z.literal(1)]),
});
const cdRow = z.object({
  version: z.number().int().positive(),
  cover_asset_id: nullable,
  edition_title: nullable,
  id: string,
  acquired_on: nullable,
  notes: nullable,
  notes_private: z.union([z.literal(0), z.literal(1)]),
  haul_id: nullable,
  haul_acquired_on: nullable,
  haul_store: nullable,
  haul_store_private: z.union([z.literal(0), z.literal(1)]).nullable(),
  album_id: string,
  title: string,
  release_id: string,
  release_date: nullable,
  date_unknown: z.union([z.literal(0), z.literal(1)]),
  cover_unavailable: z.union([z.literal(0), z.literal(1)]),
});
const credit = z.object({ display_name: string });
const tagRow = z.object({ label: string, source: string, category: string });
/**
 * The public shelf (the default) never receives a private note, nor the memory
 * tags derived from it; only the owner's view carries notes and their privacy.
 */
export async function libraryData(
  read: ReadRows,
  { owner = false }: { owner?: boolean } = {},
): Promise<LibraryData> {
  const [
    manga,
    authors,
    aliases,
    tags,
    cds,
    artists,
    labels,
    media,
    tracks,
    artwork,
  ] = await Promise.all(
    Object.values(LIBRARY_QUERIES).map((query) => read(query)),
  );
  // Index joined rows once; filtering every relationship per copy grows quadratically.
  const group = (rows: Record<string, unknown>[], key: string) => {
    const index = new Map<unknown, Record<string, unknown>[]>();
    for (const row of rows) {
      const values = index.get(row[key]) ?? [];
      values.push(row);
      index.set(row[key], values);
    }
    return (id: string) => index.get(id) ?? [];
  };
  const authorRows = group(authors!, "series_id");
  const aliasRows = group(aliases!, "series_id");
  const tagRows = group(tags!, "item_id");
  const artistRows = group(artists!, "album_id");
  const labelRows = group(labels!, "release_id");
  const mediumRows = group(media!, "release_id");
  const trackRows = group(tracks!, "release_id");
  const covers = new Map(artwork!.map(row => [row.id, row]));
  const privacy = (row: {
    id: string;
    notes: string | null;
    notes_private: 0 | 1;
    haul_id: string | null;
    haul_acquired_on: string | null;
    haul_store: string | null;
    haul_store_private: 0 | 1 | null;
  }) => {
    const hidden = !owner && row.notes_private === 1;
    return {
      notes: hidden ? null : row.notes,
      ...(owner ? { notesPrivate: row.notes_private === 1 } : {}),
      // A private haul keeps its store off the public shelf, like a private note.
      haul: row.haul_id
        ? {
            id: row.haul_id,
            acquiredOn: row.haul_acquired_on,
            store: owner || row.haul_store_private === 0 ? row.haul_store : null,
            ...(owner ? { storePrivate: row.haul_store_private !== 0 } : {}),
          }
        : null,
      tags: [
        ...new Set(
          tagRows(row.id)
            .map((tag) => tagRow.parse(tag))
            .filter(
              (tag) =>
                !hidden || tag.source !== "derived" || tag.category !== "memory",
            )
            .map((tag) => tag.label),
        ),
      ],
    };
  };
  const cover = (id: string | null): Artwork | null => {
    const value = covers.get(id);
    return value
      ? {
          url:
            value.object_key || value.provider === "mangadex"
              ? `/api/artwork/${encodeURIComponent(String(value.id))}`
              : String(value.external_url),
          scope: z.enum(["edition", "representative"]).parse(value.match_scope),
          provider: String(value.provider),
          attribution: String(value.attribution ?? ""),
          sourceUrl: String(value.source_url ?? ""),
        }
      : null;
  };
  const series = new Map<string, MangaSeries | BookSeries>();
  const seriesKinds = new Map<string, Set<string>>();
  for (const value of manga!) {
    const row = mangaRow.parse(value);
    seriesKinds.set(
      row.series_id,
      (seriesKinds.get(row.series_id) ?? new Set()).add(
        row.medium === "book" ? "book" : "manga",
      ),
    );
  }
  for (const value of manga!) {
    const row = mangaRow.parse(value);
    // Books are their own category; light novels stay with manga editions.
    const kind = row.medium === "book" ? "book" : "manga";
    const entryKey = `${kind}:${row.series_id}`;
    let entry = series.get(entryKey);
    if (!entry) {
      entry = {
        kind,
        // A series with both books and manga keeps the plain id for manga.
        id:
          kind === "book" && seriesKinds.get(row.series_id)?.has("manga")
            ? `${row.series_id}~book`
            : row.series_id,
        title: row.canonical_title,
        authors: [
          ...new Set(
            authorRows(row.series_id)
              .map((author) => credit.parse(author).display_name),
          ),
        ],
        aliases: aliasRows(row.series_id)
          .map((alias) => string.parse(alias.title)),
        copies: [],
      } as MangaSeries | BookSeries;
      series.set(entryKey, entry);
    }
    entry.copies.push({
      version: row.version,
      artwork: cover(row.cover_asset_id),
      id: row.id,
      editionRunId: row.edition_run_id,
      editionTitle: row.edition_title,
      publisher: row.publisher,
      language: row.language,
      languageBasis: row.language_basis,
      volume: row.volume_label,
      bookTitle: row.book_title,
      volumeSort: row.volume_sort,
      isbn13: row.isbn13,
      numberingBasis: row.numbering_basis,
      medium: row.medium,
      format: row.format,
      acquiredOn: row.acquired_on,
      ...privacy(row),
      // Clean-up queue flags are owner bookkeeping, not shelf data.
      ...(owner ? { dateUnknown: row.date_unknown === 1, coverUnavailable: row.cover_unavailable === 1 } : {}),
    });
  }
  const albums = new Map<string, CdAlbum>();
  for (const value of cds!) {
    const row = cdRow.parse(value);
    let entry = albums.get(row.release_id);
    if (!entry) {
      entry = {
        kind: "cd",
        artwork: cover(row.cover_asset_id),
        ...(owner ? { coverUnavailable: row.cover_unavailable === 1 } : {}),
        editionTitle: row.edition_title ?? "",
        id: row.release_id,
        title: row.title,
        releaseId: row.release_id,
        releaseDate: row.release_date,
        artists: [
          ...new Set(
            artistRows(row.album_id)
              .map((artist) => credit.parse(artist).display_name),
          ),
        ],
        labels: labelRows(row.release_id)
          .map((label) => string.parse(label.name)),
        catalogNumbers: labelRows(row.release_id)
          .filter(
            (label) =>
              label.release_id === row.release_id &&
              label.catalog_number !== null,
          )
          .map((label) => string.parse(label.catalog_number)),
        formats: [
          ...new Set(
            mediumRows(row.release_id)
              .map((medium) => string.parse(medium.format)),
          ),
        ],
        tracks: trackRows(row.release_id)
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
      version: row.version,
      ...privacy(row),
      ...(owner ? { dateUnknown: row.date_unknown === 1 } : {}),
    });
  }
  return { entries: [...series.values(), ...albums.values()] };
}
