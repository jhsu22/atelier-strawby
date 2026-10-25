import type { CdCopy, CopyHaul, LibraryEntry, MangaCopy, MangaSeries } from "./library.ts";
import { seriesGaps } from "./library.ts";
import { TAGS } from "./normalization/tags.ts";

export type Acquisition =
  | { entry: Extract<LibraryEntry, { kind: "cd" }>; copy: CdCopy }
  | { entry: Exclude<LibraryEntry, { kind: "cd" }>; copy: MangaCopy };
export interface Haul {
  date: string | null;
  items: Acquisition[];
  /** Set when these copies were logged together as one haul. */
  logged?: CopyHaul;
}
export interface TimelineFilters {
  year: string;
  media: "all" | "manga" | "book" | "cd";
  memory: string;
}
export const emptyTimelineFilters: TimelineFilters = { year: "", media: "all", memory: "" };
const editionTags = new Set<string>(TAGS.filter(tag => tag.category === "edition").map(tag => tag.label));
export function memoryTags(tags: string[]) {
  return tags.filter(tag => !editionTags.has(tag));
}
/** One visible, personal owned record per acquisition. Never count sample releases. */
export function acquisitions(entries: LibraryEntry[]): Acquisition[] {
  return entries.flatMap((entry): Acquisition[] => entry.kind === "cd"
    ? entry.copies.filter(copy => !copy.isSample).map(copy => ({ entry, copy }))
    : entry.copies.map(copy => ({ entry, copy })));
}
/**
 * Copies logged together as a haul share one group; every other copy groups by
 * its exact recorded date. Calendar strings remain untouched; the null bucket
 * is not a haul or a date.
 */
export function haulTimeline(items: Acquisition[], filters = emptyTimelineFilters): Haul[] {
  const groups = new Map<string, Haul>();
  for (const item of items) {
    if (filters.year && (item.copy.acquiredOn?.slice(0, 4) ?? "unknown") !== filters.year) continue;
    if (filters.media !== "all" && item.entry.kind !== filters.media) continue;
    if (filters.memory && !memoryTags(item.copy.tags ?? []).includes(filters.memory)) continue;
    const logged = item.copy.haul ?? undefined;
    const key = logged ? `haul:${logged.id}` : `date:${item.copy.acquiredOn ?? ""}`;
    const group = groups.get(key) ?? { date: logged ? logged.acquiredOn : item.copy.acquiredOn, items: [], ...(logged ? { logged } : {}) };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.date === b.date ? Number(Boolean(b.logged)) - Number(Boolean(a.logged)) : a.date === null ? 1 : b.date === null ? -1 : b.date.localeCompare(a.date))
    .map(({ date, items, logged }) => ({ date, ...(logged ? { logged } : {}), items: items.sort((a, b) =>
      a.entry.title.localeCompare(b.entry.title, "en", { numeric: true }) ||
      ("volume" in a.copy ? a.copy.volume : "").localeCompare("volume" in b.copy ? b.copy.volume : "", "en", { numeric: true }) ||
      a.copy.id.localeCompare(b.copy.id)) }));
}
export function distribution(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en", { numeric: true }));
}
export function collectionAnalytics(entries: LibraryEntry[]) {
  const items = acquisitions(entries);
  const manga = entries.filter((entry): entry is MangaSeries => entry.kind === "manga" && entry.copies.length > 0);
  const copies = manga.flatMap(entry => entry.copies);
  const cds = items.filter(item => item.entry.kind === "cd");
  const hauls = haulTimeline(items);
  const years = (dates: (string | null)[]) => distribution(dates.map(date => date?.slice(0, 4) ?? "Unknown date"))
    .sort((a, b) => a.label.localeCompare(b.label));
  const mostCollected = manga.map(entry => ({ id: entry.id, label: entry.title, count: entry.copies.length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const gaps = manga.flatMap(entry => seriesGaps(entry).flatMap(group =>
    group.ranges.map(range => ({ entryId: entry.id, series: entry.title, group, ...range }))))
    .sort((a, b) => b.count - a.count || a.series.localeCompare(b.series));
  return {
    mangaCopies: copies.length,
    uniqueSeries: manga.length,
    cds: cds.length,
    books: items.filter(item => item.entry.kind === "book").length,
    lightNovels: copies.filter(copy => copy.medium === "light_novel").length,
    samples: entries.flatMap(entry => entry.kind === "cd" ? entry.copies.filter(copy => copy.isSample) : []).length,
    undated: items.filter(item => item.copy.acquiredOn === null).length,
    assumedLanguages: copies.filter(copy => copy.languageBasis === "assumed").length,
    uncertainNumbering: copies.filter(copy => copy.numberingBasis !== "printed" || copy.format === "unknown").length,
    languages: distribution(copies.map(copy => copy.language)),
    publishers: distribution(copies.map(copy => copy.publisher)),
    mangaYears: years(copies.map(copy => copy.acquiredOn)),
    cdYears: years(cds.map(item => item.copy.acquiredOn)),
    authors: distribution(manga.flatMap(entry => [...new Set(entry.authors)].flatMap(author => entry.copies.map(() => author)))),
    mostCollected,
    largestHauls: hauls.filter(haul => haul.date !== null)
      .sort((a, b) => b.items.length - a.items.length || b.date!.localeCompare(a.date!)),
    gaps,
  };
}
export function calendarLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year!, month! - 1, day!);
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(calendar);
}
