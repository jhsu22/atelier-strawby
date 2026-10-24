import { z } from "zod";
import { parseIsbn } from "../../domain/isbn.ts";
import {
  CONFIDENT_MATCH,
  scanLookupRequestSchema,
  scanLookupResultSchema,
} from "../../domain/scan.ts";
import type { ScanEdition, ScanLookupResult, ScanMatch } from "../../domain/scan.ts";
import type { Store } from "../db/store.ts";
import { ApiError } from "../http/api.ts";
import { providerJson } from "../metadata/http.ts";
import type { Fetcher } from "../metadata/http.ts";
import { editionConflicts, googleEditions, openLibraryEditions, rankEditions } from "./catalog.ts";
import { reconcile, titleKey } from "./reconcile.ts";
import type { CollectionIndex, IndexedRun } from "./reconcile.ts";

export interface ScanOptions {
  fetcher?: Fetcher;
  googleBooksKey?: string;
  contact?: string;
}

// Copies from an import that has not completed are not part of the collection.
const visibleCopy = `i.id IS NOT NULL AND (i.import_batch_id IS NULL OR EXISTS
  (SELECT 1 FROM import_batches b WHERE b.id=i.import_batch_id AND b.status='complete'))`;

export async function collectionIndex(db: Store): Promise<CollectionIndex> {
  const [series, runs, aliases, credits, volumes] = await Promise.all([
    db.all("SELECT id,canonical_title FROM series ORDER BY id"),
    db.all(`SELECT r.id,r.series_id,r.edition_title,r.language,r.language_basis,r.format,r.numbering_basis,r.medium,
      COALESCE(p.name,'') AS publisher FROM edition_runs r LEFT JOIN publishers p ON p.id=r.publisher_id ORDER BY r.id`),
    db.all("SELECT series_id,title FROM series_aliases ORDER BY title"),
    db.all(`SELECT sc.series_id,c.display_name FROM series_creators sc JOIN creators c ON c.id=sc.creator_id
      ORDER BY sc.series_id,sc.credit_order`),
    db.all(`SELECT e.edition_run_id,e.volume_label,e.isbn13,i.id AS item_id,i.acquired_on FROM volume_editions e
      LEFT JOIN volumes v ON v.volume_edition_id=e.id LEFT JOIN collection_items i ON i.id=v.item_id
      ORDER BY e.id,i.acquired_on,i.id`),
  ]);
  const byVolume = new Map<string, CollectionIndex["volumes"][number]>();
  for (const row of volumes) {
    const key = `${String(row.edition_run_id)}\u0000${String(row.volume_label)}`;
    const entry = byVolume.get(key) ?? {
      runId: String(row.edition_run_id),
      volume: String(row.volume_label),
      isbn13: (row.isbn13 as string | null) ?? null,
      copies: [],
    };
    byVolume.set(key, entry);
    if (row.item_id) entry.copies.push({ id: String(row.item_id), acquiredOn: (row.acquired_on as string | null) ?? null });
  }
  const visible = new Set(
    (await db.all(`SELECT i.id FROM collection_items i WHERE ${visibleCopy}`)).map((row) => String(row.id)),
  );
  for (const entry of byVolume.values()) entry.copies = entry.copies.filter((copy) => visible.has(copy.id));
  return {
    series: series.map((row) => ({
      id: String(row.id),
      title: String(row.canonical_title),
      aliases: aliases.filter((alias) => alias.series_id === row.id).map((alias) => String(alias.title)),
      authors: credits.filter((credit) => credit.series_id === row.id).map((credit) => String(credit.display_name)),
      runs: runs
        .filter((run) => run.series_id === row.id)
        .map((run) => ({
          id: String(run.id),
          editionTitle: String(run.edition_title),
          language: run.language as IndexedRun["language"],
          languageBasis: run.language_basis as IndexedRun["languageBasis"],
          publisher: String(run.publisher),
          format: run.format as IndexedRun["format"],
          numberingBasis: run.numbering_basis as IndexedRun["numberingBasis"],
          medium: run.medium as IndexedRun["medium"],
        })),
    })),
    volumes: [...byVolume.values()],
  };
}

/** Owned volume editions that already record this exact ISBN. */
function isbnMatches(index: CollectionIndex, isbn13: string): ScanMatch[] {
  const matches: ScanMatch[] = [];
  for (const volume of index.volumes.filter((entry) => entry.isbn13 === isbn13)) {
    const series = index.series.find((entry) => entry.runs.some((run) => run.id === volume.runId));
    const run = series?.runs.find((entry) => entry.id === volume.runId);
    if (!series || !run) continue;
    matches.push({
      seriesId: series.id,
      seriesTitle: series.title,
      aliases: series.aliases.slice(0, 50),
      authors: series.authors.slice(0, 30),
      medium: run.medium,
      run: {
        editionTitle: run.editionTitle,
        language: run.language,
        languageBasis: run.languageBasis,
        publisher: run.publisher,
        format: run.format,
        numberingBasis: run.numberingBasis,
      },
      volume: volume.volume,
      copies: volume.copies.map((copy) => ({ ...copy, isbn13 })),
      recordedIsbn: isbn13,
      basis: "isbn",
      score: 1,
      reasons: [
        volume.copies.length
          ? `You own ${volume.copies.length} ${volume.copies.length === 1 ? "copy" : "copies"} recorded with this ISBN.`
          : "This ISBN is recorded in your collection.",
      ],
    });
  }
  return matches;
}

/** MangaDex alternate titles bridge scripts, e.g. 薫る花は凛と咲く ↔ The Fragrant Flower… */
async function bridgeTitles(db: Store, title: string, options: ScanOptions, retry: boolean): Promise<string[]> {
  const payload = await providerJson(
    db,
    "mangadex",
    `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=3&order[relevance]=desc&contentRating[]=safe&contentRating[]=suggestive`,
    { ...options, retry },
  );
  const strings = (value: unknown) =>
    z.record(z.unknown()).safeParse(value).success
      ? Object.values(value as Record<string, unknown>).filter((entry): entry is string => typeof entry === "string")
      : [];
  const data = z.object({ data: z.array(z.unknown()).default([]) }).catch({ data: [] }).parse(payload ?? {}).data;
  const titles: string[] = [];
  for (const manga of data.slice(0, 3)) {
    const attributes = z.object({ attributes: z.record(z.unknown()) }).safeParse(manga);
    if (!attributes.success) continue;
    const alt = Array.isArray(attributes.data.attributes.altTitles) ? attributes.data.attributes.altTitles : [];
    const all = [...strings(attributes.data.attributes.title), ...alt.flatMap(strings)];
    // Only trust a MangaDex work whose own titles include the scanned title.
    if (all.some((entry) => titleKey(entry) === titleKey(title))) titles.push(...all);
  }
  return [...new Set(titles)].slice(0, 60);
}

export async function lookupIsbn(db: Store, raw: unknown, options: ScanOptions = {}): Promise<ScanLookupResult> {
  const request = scanLookupRequestSchema.parse(raw);
  const isbn = parseIsbn(request.code);
  if (!isbn.ok) throw new ApiError(422, isbn.message);
  const { isbn13, isbn10 } = isbn;
  const warnings: string[] = [];
  const failures: ScanLookupResult["failures"] = [];
  const index = await collectionIndex(db);
  const exact = isbnMatches(index, isbn13);
  const finish = (editions: ScanEdition[], matches: ScanMatch[], local: boolean) => {
    const best = matches[0];
    const exactCopies = exact.flatMap((match) => match.copies);
    const duplicate: ScanLookupResult["duplicate"] = exactCopies.length
      ? { level: "exact-isbn", copies: exactCopies }
      : best && best.score >= CONFIDENT_MATCH && best.copies.length
        ? { level: "same-volume", copies: best.copies }
        : { level: "none", copies: [] };
    return scanLookupResultSchema.parse({
      isbn13,
      isbn10,
      languageHint: isbn.hint,
      editions: editions.slice(0, 10),
      matches,
      duplicate,
      local,
      warnings: [...new Set(warnings)].slice(0, 20),
      failures,
    });
  };
  // The collection answers repeat scans without any provider request.
  if (exact.length && !request.retry) return finish([], exact.slice(0, 5), true);

  const attempt = async (provider: string, task: () => Promise<ScanEdition[]>) => {
    try {
      return await task();
    } catch (error) {
      failures.push({ provider, status: error instanceof ApiError ? error.status : 502 });
      warnings.push(error instanceof ApiError ? `${provider === "googlebooks" ? "Google Books" : "Open Library"}: ${error.message}` : `${provider} lookup failed.`);
      return [];
    }
  };
  const bibkeys = [isbn13, ...(isbn10 ? [isbn10] : [])].map((value) => `ISBN:${value}`).join(",");
  const [google, openLibrary] = await Promise.all([
    options.googleBooksKey?.trim()
      ? attempt("googlebooks", async () =>
          googleEditions(
            await providerJson(
              db,
              "googlebooks",
              `https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({ q: `isbn:${isbn13}`, printType: "books", maxResults: "5" })}`,
              { ...options, retry: request.retry },
            ),
            isbn13,
            isbn10,
          ),
        )
      : Promise.resolve([]),
    attempt("openlibrary", async () =>
      openLibraryEditions(
        await providerJson(
          db,
          "openlibrary",
          `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibkeys)}&format=json&jscmd=details`,
          { ...options, retry: request.retry },
        ),
        isbn13,
        isbn10,
      ),
    ),
  ]);
  // Google's isbn: search can return nothing for ISBNs that its title search
  // lists (observed for every test-set ISBN on 2026-10-24). One title search
  // recovers them; only records listing the scanned ISBN are kept.
  const seed = openLibrary.find((edition) => edition.isbnVerified);
  if (
    options.googleBooksKey?.trim() &&
    seed &&
    !google.length &&
    !failures.some((failure) => failure.provider === "googlebooks")
  ) {
    const query = `intitle:${(seed.seriesTitle || seed.title).replace(/[:"]/g, " ")}${seed.volume ? ` ${seed.volume}` : ""}`;
    google.push(
      ...(await attempt("googlebooks", async () =>
        googleEditions(
          await providerJson(
            db,
            "googlebooks",
            `https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({ q: query, printType: "books", maxResults: "20" })}`,
            { ...options, retry: request.retry },
          ),
          isbn13,
          isbn10,
          20,
        ).filter((edition) => edition.isbnVerified),
      )),
    );
  }
  const editions = rankEditions([...google, ...openLibrary]);
  const verified = editions.filter((edition) => edition.isbnVerified);
  warnings.push(...editionConflicts(editions));
  if (!verified.length)
    warnings.push(
      failures.length === (options.googleBooksKey?.trim() ? 2 : 1)
        ? "Catalog services are unavailable. Enter the details from the book, or retry later."
        : "No catalog lists this ISBN yet. Enter the details from the book; the scanned ISBN is kept.",
    );
  const best = verified[0];
  const reconcileInput = {
    editions,
    language: best?.language ?? isbn.hint,
    volume: best?.volume ?? null,
    medium: best?.medium ?? null,
    format: best?.format ?? null,
  };
  let matches = reconcile(index, reconcileInput);
  if (best && (matches[0]?.score ?? 0) < CONFIDENT_MATCH) {
    try {
      const titles = await bridgeTitles(db, best.seriesTitle || best.title, options, request.retry);
      if (titles.length) matches = reconcile(index, { ...reconcileInput, bridgeTitles: titles });
    } catch {
      // The bridge only improves matching; its absence leaves manual choice.
    }
  }
  return finish(editions, [...exact, ...matches.filter((match) => !exact.some((entry) => entry.seriesId === match.seriesId))].slice(0, 5), false);
}
