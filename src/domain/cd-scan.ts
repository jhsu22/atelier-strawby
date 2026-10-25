import { z } from "zod";
import type { CdAlbum } from "./library.ts";
import { key } from "./item.ts";

// Strict boundary schemas for CD barcode lookups, parsed on both sides like
// the ISBN lookup's.
const text = z.string().max(500);
export const CD_LOOKUP_BYTES = 2048;
export const cdLookupRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(32),
    source: z.enum(["camera", "photo", "manual"]),
    /** Bypass the D1 provider cache, for example after an outage. */
    retry: z.boolean().default(false),
  })
  .strict();
export type CdLookupRequest = z.input<typeof cdLookupRequestSchema>;

/** One MusicBrainz release listing the scanned barcode, from the search. */
export const cdReleaseSchema = z
  .object({
    id: z.string().uuid(),
    title: text,
    artists: z.array(text).max(30),
    date: text,
    country: text,
    disambiguation: text,
    formats: z.array(text).max(20),
    labels: z.array(z.object({ name: text, catalogNumber: text }).strict()).max(20),
    trackCount: z.number().int().nonnegative(),
  })
  .strict();
export type CdRelease = z.infer<typeof cdReleaseSchema>;
const ownedCopy = z
  .object({ id: z.string().max(100), entryId: z.string().max(100), title: text, acquiredOn: z.string().nullable() })
  .strict();
export const cdLookupResultSchema = z
  .object({
    barcode: z.string().regex(/^\d{13}$/),
    /** MusicBrainz releases with this barcode; several pressings can share one. */
    releases: z.array(cdReleaseSchema).max(10),
    /** Owned CD copies whose release records this barcode. */
    owned: z.array(ownedCopy).max(100),
    /** Owned releases of the same album (title and artist) without this barcode. */
    albums: z.array(z.object({ entryId: z.string().max(100), title: text, copies: z.number().int().positive() }).strict()).max(10),
    /** True when the collection answered without a provider request. */
    local: z.boolean(),
    warnings: z.array(text).max(20),
    failures: z.array(z.object({ provider: z.string().max(40), status: z.number().int() }).strict()).max(5),
  })
  .strict();
export type CdLookupResult = z.infer<typeof cdLookupResultSchema>;

/** The same album: matching title and at least one shared artist (or none credited). */
export function sameAlbum(album: { title: string; artists: string[] }, release: { title: string; artists: string[] }) {
  if (key(album.title) !== key(release.title)) return false;
  const artists = new Set(album.artists.map(key));
  return !artists.size || !release.artists.length || release.artists.some((artist) => artists.has(key(artist)));
}

export interface CdOwnershipAnswer {
  /** owned: a copy records this barcode; album: another edition is owned; new: neither. */
  verdict: "owned" | "album" | "new";
  title: string | null;
  artists: string[];
  copies: { id: string; acquiredOn: string | null }[];
  albums: CdLookupResult["albums"];
  entryId: string | null;
}
/** Read-only "do I own this?" for a scanned CD. Nothing is saved. */
export function cdOwnershipAnswer(result: CdLookupResult): CdOwnershipAnswer {
  const release = result.releases[0];
  const owned = result.owned[0];
  return {
    verdict: result.owned.length ? "owned" : result.albums.length ? "album" : "new",
    title: owned?.title ?? release?.title ?? null,
    artists: release?.artists ?? [],
    copies: result.owned.map(({ id, acquiredOn }) => ({ id, acquiredOn })),
    albums: result.albums,
    entryId: owned?.entryId ?? result.albums[0]?.entryId ?? null,
  };
}

/** Marks a CD answer from the shelf saved on this device. */
export const CD_OFFLINE_PROVIDER = "offline";
/**
 * With no connection, answer from CDs on the saved shelf whose barcode is
 * recorded. A miss is never "not owned": older CDs have no barcode.
 */
export function offlineCdLookup(barcode: string, albums: CdAlbum[]): CdLookupResult {
  const hits = albums.filter((album) => album.barcode === barcode);
  return {
    barcode,
    releases: [],
    owned: hits.flatMap((album) => album.copies.map((copy) => ({ id: copy.id, entryId: album.id, title: album.title, acquiredOn: copy.acquiredOn }))),
    albums: [],
    local: true,
    warnings: ["The server couldn’t be reached, so this was answered from the shelf saved on this device. MusicBrainz wasn’t checked."],
    failures: [{ provider: CD_OFFLINE_PROVIDER, status: 0 }],
  };
}
export const cdAnsweredOffline = (result: CdLookupResult) => result.failures.some((failure) => failure.provider === CD_OFFLINE_PROVIDER);
