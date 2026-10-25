import { z } from "zod";
import { barcodeForms, parseProductBarcode } from "../../domain/barcode.ts";
import { cdLookupRequestSchema, cdLookupResultSchema, sameAlbum } from "../../domain/cd-scan.ts";
import type { CdLookupResult, CdRelease } from "../../domain/cd-scan.ts";
import type { Store } from "../db/store.ts";
import { ApiError } from "../http/api.ts";
import { providerJson } from "../metadata/http.ts";
import type { ScanOptions } from "./lookup.ts";

const record = (value: unknown) => z.record(z.unknown()).catch({}).parse(value ?? {});
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const str = (value: unknown) => (typeof value === "string" ? value.slice(0, 500) : "");
// Copies from an import that has not completed are not part of the collection.
const visible = `(i.import_batch_id IS NULL OR EXISTS
  (SELECT 1 FROM import_batches b WHERE b.id=i.import_batch_id AND b.status='complete'))`;

/** MusicBrainz search releases, kept only when they list this exact barcode. */
export function barcodeReleases(payload: unknown, gtin13: string): CdRelease[] {
  const forms = new Set(barcodeForms(gtin13));
  const releases: CdRelease[] = [];
  for (const release of list(record(payload).releases)) {
    const id = z.string().uuid().safeParse(release.id);
    // The search is fuzzy; a release that lists another barcode is not this CD.
    if (!id.success || !forms.has(str(release.barcode).replace(/\D/g, "")) || releases.some((entry) => entry.id === id.data)) continue;
    const media = list(release.media);
    releases.push({
      id: id.data,
      title: str(release.title),
      artists: list(release["artist-credit"]).map((credit) => str(credit.name) || str(record(credit.artist).name)).filter(Boolean).slice(0, 30),
      date: str(release.date),
      country: str(release.country),
      disambiguation: str(release.disambiguation),
      formats: media.map((medium) => str(medium.format)).filter(Boolean).slice(0, 20),
      labels: list(release["label-info"])
        .map((info) => ({ name: str(record(info.label).name), catalogNumber: str(info["catalog-number"]) }))
        .filter((label) => label.name || label.catalogNumber)
        .slice(0, 20),
      trackCount: Number.isSafeInteger(release["track-count"])
        ? Number(release["track-count"])
        : media.reduce((sum, medium) => sum + (Number.isSafeInteger(medium["track-count"]) ? Number(medium["track-count"]) : 0), 0),
    });
    if (releases.length === 10) break;
  }
  return releases;
}

/** Look up a scanned CD barcode: the collection first, then MusicBrainz. */
export async function lookupCdBarcode(db: Store, raw: unknown, options: ScanOptions = {}): Promise<CdLookupResult> {
  const request = cdLookupRequestSchema.parse(raw);
  const parsed = parseProductBarcode(request.code);
  if (!parsed.ok) throw new ApiError(422, parsed.message);
  const barcode = parsed.gtin13;
  if (/^97[89]/.test(barcode)) throw new ApiError(422, "That is a book’s ISBN. Scan it to add a book.");
  const owned = (
    await db.all(
      `SELECT i.id,r.id AS entryId,a.title,i.acquired_on AS acquiredOn FROM album_releases r JOIN albums a ON a.id=r.album_id
      JOIN cds c ON c.release_id=r.id JOIN collection_items i ON i.id=c.item_id WHERE r.barcode=? AND ${visible}
      ORDER BY i.acquired_on,i.id LIMIT 100`,
      [barcode],
    )
  ).map((row) => ({ id: String(row.id), entryId: String(row.entryId), title: String(row.title), acquiredOn: (row.acquiredOn as string | null) ?? null }));
  const warnings: string[] = [];
  const failures: CdLookupResult["failures"] = [];
  const finish = (releases: CdRelease[], albums: CdLookupResult["albums"], local: boolean) =>
    cdLookupResultSchema.parse({ barcode, releases, owned, albums, local, warnings, failures });
  // A rescan of a recorded barcode needs no provider request.
  if (owned.length && !request.retry) return finish([], [], true);
  let releases: CdRelease[] = [];
  try {
    const query = barcodeForms(barcode).map((form) => `barcode:${form}`).join(" OR ");
    releases = barcodeReleases(
      await providerJson(db, "musicbrainz", `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&limit=25&fmt=json`, {
        ...options,
        retry: request.retry,
      }),
      barcode,
    );
    if (!releases.length) warnings.push("MusicBrainz doesn’t list this barcode yet. Enter the details from the CD; the barcode is kept.");
  } catch (error) {
    failures.push({ provider: "musicbrainz", status: error instanceof ApiError ? error.status : 502 });
    warnings.push(
      error instanceof ApiError
        ? `MusicBrainz: ${error.message}`
        : "MusicBrainz could not be reached. Retry, or enter the details from the CD.",
    );
  }
  // Another pressing of an owned album is worth knowing about before buying.
  const albums: CdLookupResult["albums"] = [];
  if (releases.length) {
    const rows = await db.all(
      `SELECT r.id AS entryId,a.title,GROUP_CONCAT(cr.display_name,char(31)) AS artists,COUNT(DISTINCT c.item_id) AS copies
      FROM album_releases r JOIN albums a ON a.id=r.album_id JOIN cds c ON c.release_id=r.id JOIN collection_items i ON i.id=c.item_id
      LEFT JOIN album_creators ac ON ac.album_id=a.id LEFT JOIN creators cr ON cr.id=ac.creator_id
      WHERE (r.barcode IS NULL OR r.barcode<>?) AND ${visible} GROUP BY r.id ORDER BY a.sort_title,r.id`,
      [barcode],
    );
    for (const row of rows) {
      const album = { title: String(row.title), artists: row.artists ? String(row.artists).split("\u001f") : [] };
      if (releases.some((release) => sameAlbum(album, release)) && albums.length < 10)
        albums.push({ entryId: String(row.entryId), title: album.title, copies: Number(row.copies) });
    }
  }
  return finish(releases, albums, false);
}
