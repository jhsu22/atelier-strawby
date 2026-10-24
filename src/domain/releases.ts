import { z } from "zod";
import type { MangaCopy, MangaSeries } from "./library.ts";
import { seriesGaps } from "./library.ts";
import { validDate } from "./item.ts";

export const releasedVolumeSchema = z.object({
  number: z.number().int().positive().safe(),
  title: z.string(),
  sourceUrl: z.string().url().refine(url => /^https:\/\/(books\.google\.com|openlibrary\.org)\//.test(url)),
  publishedOn: z.string().refine(validDate),
  datePrecision: z.enum(["day", "month", "year"]),
  provider: z.enum(["googlebooks", "openlibrary"]),
  digital: z.boolean().nullable(),
});
export type ReleasedVolume = z.infer<typeof releasedVolumeSchema>;
export const releaseCatalogSchema = z.object({
  editionRunId: z.string(), query: z.string(),
  provider: z.enum(["googlebooks", "openlibrary"]),
  checkedAt: z.string(),
  volumes: z.array(releasedVolumeSchema).max(4000),
  scanned: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  warnings: z.array(z.string()),
  lastPageSignature: z.string().nullable().optional(),
});
export type ReleaseCatalog = z.infer<typeof releaseCatalogSchema>;
export function releaseScope(entry: MangaSeries, editionRunId: string) {
  const copies = entry.copies.filter(copy => copy.editionRunId === editionRunId);
  const groups = seriesGaps({ ...entry, copies });
  const first = copies[0];
  if (!first) return { copy: undefined, reason: "This edition has no owned copies." };
  const reason = groups.length !== 1 ? "Conflicting edition metadata needs review before comparing releases."
    : groups[0]!.reason ?? (!["standard", "collectors", "omnibus"].includes(first.format) ? "Release comparison supports standard, collector and explicitly numbered omnibus editions." : null);
  return { copy: first, reason };
}
/** End of a partial publication date: current-year/month dates need more evidence. */
export function publicationDate(raw: string): { date: string; precision: "day" | "month" | "year" } | null {
  if (/^\d{4}$/.test(raw)) return validDate(`${raw}-12-31`) ? {date: `${raw}-12-31`, precision: "year"} : null;
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split("-").map(Number);
    if (!validDate(`${raw}-01`)) return null;
    const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
    const day = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month! - 1];
    return {date: `${raw}-${day}`, precision: "month"};
  }
  if (validDate(raw)) return {date: raw, precision: "day"};
  // Open Library often supplies an English calendar date instead of ISO.
  const names = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const match = /^(\w+)\s+(?:(\d{1,2}),?\s+)?(\d{4})$/i.exec(raw.trim());
  if (!match) return null;
  const month = names.findIndex(name => name === match[1]!.toLowerCase());
  if (month < 0) return null;
  return publicationDate(`${match[3]}-${String(month + 1).padStart(2, "0")}${match[2] ? `-${match[2].padStart(2, "0")}` : ""}`);
}
export function compareReleases(copies: MangaCopy[], catalog: ReleaseCatalog, today = new Date().toISOString().slice(0, 10)) {
  const owned = new Set(copies.filter(copy => copy.editionRunId === catalog.editionRunId && copy.numberingBasis === "printed" && /^\d+$/.test(copy.volume)).map(copy => Number(copy.volume)));
  const unique = new Map<number, ReleasedVolume>();
  for (const volume of catalog.volumes) {
    if (volume.publishedOn > today) continue;
    const prior = unique.get(volume.number);
    if (!prior || prior.digital === true && volume.digital !== true) unique.set(volume.number, volume);
  }
  const released = [...unique.values()].sort((a, b) => a.number - b.number);
  return { released, missing: released.filter(volume => !owned.has(volume.number)), owned: released.filter(volume => owned.has(volume.number)) };
}
