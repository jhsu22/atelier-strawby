import { z } from "zod";
import { artworkSchema, key as numberingKey, validDate } from "./item.ts";
import type { Artwork, CdAlbum, CdCopy, CopyHaul, LibraryEntry, MangaCopy, SeriesEntry } from "./library.ts";
import { volumeRanges } from "./scan.ts";

/**
 * The data clean-up queue: the caveats the stats page hedges on, one card at a
 * time. Language and numbering belong to an edition run, so one card covers
 * every copy of that edition; a cover belongs to a volume edition or CD release.
 */
export const CLEANUP_KINDS = ["language", "numbering", "date", "cover", "missing-cover"] as const;
export type CleanupKind = (typeof CLEANUP_KINDS)[number];
export const CLEANUP_LABELS: Record<CleanupKind, { title: string; help: string }> = {
  language: { title: "Assumed language", help: "Editions whose language was assumed, not read from the book." },
  numbering: { title: "Numbering or format", help: "Editions whose format or printed numbering isn’t confirmed." },
  date: { title: "Missing date", help: "Copies with no acquisition date." },
  cover: { title: "Representative cover", help: "Covers that may show another printing or edition." },
  "missing-cover": { title: "No cover", help: "Volumes and CDs with no cover yet." },
};

export interface EditionTask {
  kind: "language" | "numbering";
  key: string;
  entry: SeriesEntry;
  runId: string;
  /** Every copy in the edition, in volume order. */
  copies: MangaCopy[];
  volumes: string;
}
export interface DateTask {
  kind: "date";
  key: string;
  /** One copy, or every undated copy of one logged haul. */
  items: { entry: LibraryEntry; copy: MangaCopy | CdCopy }[];
  haul: CopyHaul | null;
}
export interface CoverTask {
  kind: "cover" | "missing-cover";
  key: string;
  entry: LibraryEntry;
  /** A copy of the volume edition or release; the server resolves the cover from it. */
  copy: MangaCopy | CdCopy;
  /** Owned copies sharing this cover. */
  copies: number;
  artwork: Artwork | null;
}
export type CleanupTask = EditionTask | DateTask | CoverTask;
export const isCoverTask = (task: CleanupTask): task is CoverTask => task.kind === "cover" || task.kind === "missing-cover";
export type CleanupQueue = Record<CleanupKind, CleanupTask[]>;

const byVolume = (a: MangaCopy, b: MangaCopy) =>
  (a.volumeSort ?? Infinity) - (b.volumeSort ?? Infinity) ||
  a.volume.localeCompare(b.volume, "en", { numeric: true }) ||
  (a.bookTitle ?? "").localeCompare(b.bookTitle ?? "", "en", { numeric: true });
/** The volume edition a copy belongs to, as the server keys it. */
const volumeKey = (copy: MangaCopy) => `${copy.editionRunId}\u0000${numberingKey(copy.volume || copy.bookTitle || "")}`;
/** Copies the stats count for language and numbering: manga and light novels. */
export const uncertainNumbering = (copy: MangaCopy) => copy.numberingBasis !== "printed" || copy.format === "unknown";

export function cleanupQueue(entries: LibraryEntry[]): CleanupQueue {
  const queue: CleanupQueue = { language: [], numbering: [], date: [], cover: [], "missing-cover": [] };
  const sorted = [...entries].sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true }) || a.id.localeCompare(b.id));
  const hauls = new Map<string, DateTask>();
  for (const entry of sorted) {
    if (entry.kind === "cd") {
      const cd: CdAlbum = entry;
      const anchor = cd.copies[0];
      if (anchor) {
        if (cd.artwork?.scope === "representative")
          queue.cover.push({ kind: "cover", key: `cd:${cd.id}`, entry, copy: anchor, copies: cd.copies.length, artwork: cd.artwork });
        if (!cd.artwork && !cd.coverUnavailable)
          queue["missing-cover"].push({ kind: "missing-cover", key: `cd:${cd.id}`, entry, copy: anchor, copies: cd.copies.length, artwork: null });
      }
      for (const copy of cd.copies) addDate(queue, hauls, entry, copy);
      continue;
    }
    const copies = [...entry.copies].sort(byVolume);
    const runs = new Map<string, MangaCopy[]>();
    for (const copy of copies) runs.set(copy.editionRunId, [...(runs.get(copy.editionRunId) ?? []), copy]);
    // Matches the stats page, which counts manga and light novels only.
    if (entry.kind === "manga")
      for (const [runId, run] of runs) {
        const task = { key: `${entry.id}:${runId}`, entry, runId, copies: run, volumes: volumeRanges(run.map((copy) => copy.volume || copy.bookTitle || "")) };
        if (run[0]!.languageBasis === "assumed") queue.language.push({ ...task, kind: "language" });
        if (uncertainNumbering(run[0]!)) queue.numbering.push({ ...task, kind: "numbering" });
      }
    const volumes = new Map<string, MangaCopy[]>();
    for (const copy of copies) volumes.set(volumeKey(copy), [...(volumes.get(volumeKey(copy)) ?? []), copy]);
    for (const [key, shared] of volumes) {
      const copy = shared[0]!;
      if (copy.artwork?.scope === "representative")
        queue.cover.push({ kind: "cover", key, entry, copy, copies: shared.length, artwork: copy.artwork });
      if (!copy.artwork && !copy.coverUnavailable)
        queue["missing-cover"].push({ kind: "missing-cover", key, entry, copy, copies: shared.length, artwork: null });
    }
    for (const copy of copies) addDate(queue, hauls, entry, copy);
  }
  return queue;
}
function addDate(queue: CleanupQueue, hauls: Map<string, DateTask>, entry: LibraryEntry, copy: MangaCopy | CdCopy) {
  if (copy.acquiredOn !== null || copy.dateUnknown) return;
  // A logged haul has one date for all its copies, so it is reviewed once.
  const haul = copy.haul ?? null;
  const existing = haul ? hauls.get(haul.id) : undefined;
  if (existing) {
    existing.items.push({ entry, copy });
    return;
  }
  const task: DateTask = { kind: "date", key: haul ? `haul:${haul.id}` : copy.id, items: [{ entry, copy }], haul };
  if (haul) hauls.set(haul.id, task);
  queue.date.push(task);
}

const language = z.enum(["EN", "JP", "KR"]);
const id = z.string().min(1).max(100);
const version = z.number().int().positive();
export const CLEANUP_REQUEST_BYTES = 8 * 1024;
export const cleanupRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("edition"),
      runId: id,
      /** The edition as the owner saw it; a mismatch means it changed meanwhile. */
      seen: z
        .object({
          language,
          languageBasis: z.enum(["specified", "assumed", "confirmed"]),
          format: z.enum(["standard", "omnibus", "collectors", "artbook", "anthology", "unknown"]),
          numberingBasis: z.enum(["printed", "source_record", "unknown"]),
        })
        .strict(),
      /** A language here is the owner's confirmation of it. */
      language: language.optional(),
      format: z.enum(["standard", "omnibus", "collectors", "artbook", "anthology"]).optional(),
      numberingBasis: z.literal("printed").optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("date"),
      copyId: id,
      version,
      /** null records that the owner doesn't know the date. */
      acquiredOn: z.string().nullable().refine((value) => value === null || validDate(value), "Use a valid acquisition date"),
    })
    .strict(),
  z
    .object({ action: z.literal("cover"), copyId: id, version, decision: z.enum(["confirm", "remove", "unavailable"]) })
    .strict(),
  z.object({ action: z.literal("apply-cover"), copyId: id, version, artwork: artworkSchema }).strict(),
]);
export type CleanupRequest = z.input<typeof cleanupRequestSchema>;
export const coverCandidatesRequestSchema = z.object({ copyId: id, retry: z.boolean().default(false) }).strict();
export interface CoverCandidate {
  artwork: z.output<typeof artworkSchema>;
  label: string;
  /** The provider matched this volume and language exactly. */
  exact: boolean;
}
export interface CoverCandidates {
  candidates: CoverCandidate[];
  warnings: string[];
}
