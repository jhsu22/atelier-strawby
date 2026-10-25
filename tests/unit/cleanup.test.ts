import test from "node:test";
import assert from "node:assert/strict";
import type { CdAlbum, LibraryEntry, MangaCopy, MangaSeries } from "../../src/domain/library.ts";
import { cleanupQueue, cleanupRequestSchema } from "../../src/domain/cleanup.ts";
import type { CoverTask, DateTask, EditionTask } from "../../src/domain/cleanup.ts";

const copy = (volume: string, extra: Partial<MangaCopy> = {}): MangaCopy => ({
  id: `copy-${volume}-${extra.editionRunId ?? "run"}${extra.id ?? ""}`, editionRunId: "run", editionTitle: "Story", language: "EN", languageBasis: "assumed", publisher: "House", volume, volumeSort: Number(volume) * 1000, numberingBasis: "printed", medium: "manga", format: "standard", acquiredOn: "2024-02-29", notes: null, tags: [], artwork: { url: "https://example.com/a.jpg", scope: "edition", attribution: "", provider: "manual", sourceUrl: "" }, ...extra,
});
const series = (title: string, copies: MangaCopy[], kind: "manga" | "book" = "manga"): MangaSeries => ({ kind: kind as "manga", id: title, title, authors: [], aliases: [], copies });
const cd = (patch: Partial<CdAlbum> = {}): CdAlbum => ({ kind: "cd", id: "album", title: "Album", releaseId: "album", artists: [], releaseDate: null, formats: [], labels: [], catalogNumbers: [], tracks: [], copies: [{ id: "cd-1", acquiredOn: "2024-01-01", notes: null }], ...patch });

test("language and numbering are one card per edition, in title and volume order", () => {
  const entries: LibraryEntry[] = [
    series("Zebra", [copy("1")]),
    series("Apple", [copy("3"), copy("1"), copy("2", { id: "-dup" }), copy("2"), copy("1", { editionRunId: "jp", language: "JP", languageBasis: "confirmed", format: "unknown" })]),
    series("Book", [copy("1")], "book"),
  ];
  const queue = cleanupQueue(entries);
  const language = queue.language as EditionTask[];
  assert.deepEqual(language.map((task) => task.entry.title), ["Apple", "Zebra"], "books are left to the editor, like the stats");
  assert.equal(language[0]!.copies.length, 4);
  assert.equal(language[0]!.volumes, "1–3");
  assert.deepEqual(language[0]!.copies.map((entry) => entry.volume), ["1", "2", "2", "3"]);
  assert.deepEqual((queue.numbering as EditionTask[]).map((task) => task.runId), ["jp"]);
});

test("dates group a logged haul, skip known and remembered-unknown dates, and include CDs", () => {
  const haul = { id: "haul-1", acquiredOn: null, store: "Shop" };
  const queue = cleanupQueue([
    series("Story", [copy("1", { acquiredOn: null, haul }), copy("2", { acquiredOn: null, haul }), copy("3", { acquiredOn: null }), copy("4", { acquiredOn: null, dateUnknown: true })]),
    cd({ copies: [{ id: "cd-1", acquiredOn: null, notes: null }] }),
  ]);
  const dates = queue.date as DateTask[];
  assert.deepEqual(dates.map((task) => task.items.length), [1, 2, 1]);
  assert.equal(dates.find((task) => task.haul)!.key, "haul:haul-1");
});

test("covers are one card per volume edition or release, and remembered gaps stay out", () => {
  const representative = { url: "https://example.com/r.jpg", scope: "representative" as const, attribution: "", provider: "openlibrary", sourceUrl: "" };
  const queue = cleanupQueue([
    series("Story", [copy("1", { artwork: representative }), copy("1", { id: "-dup", artwork: representative }), copy("2", { artwork: null }), copy("3", { artwork: null, coverUnavailable: true })]),
    cd({ artwork: null }),
    cd({ id: "other", releaseId: "other", artwork: null, coverUnavailable: true }),
  ]);
  const covers = queue.cover as CoverTask[];
  assert.equal(covers.length, 1);
  assert.equal(covers[0]!.copies, 2, "duplicate copies share one cover card");
  assert.deepEqual((queue["missing-cover"] as CoverTask[]).map((task) => task.key.startsWith("cd:") ? task.key : (task.copy as MangaCopy).volume), ["cd:album", "2"]);
  assert.deepEqual(cleanupQueue([]), { language: [], numbering: [], date: [], cover: [], "missing-cover": [] });
});

test("clean-up requests are strict and validate dates", () => {
  const seen = { language: "EN", languageBasis: "assumed", format: "standard", numberingBasis: "printed" };
  assert.equal(cleanupRequestSchema.safeParse({ action: "edition", runId: "r", seen, language: "JP" }).success, true);
  assert.equal(cleanupRequestSchema.safeParse({ action: "edition", runId: "r", seen, format: "unknown" }).success, false, "a fix never sets an unknown format");
  assert.equal(cleanupRequestSchema.safeParse({ action: "edition", runId: "r", seen, languageBasis: "confirmed" }).success, false);
  assert.equal(cleanupRequestSchema.safeParse({ action: "date", copyId: "c", version: 1, acquiredOn: "2024-02-30" }).success, false);
  assert.equal(cleanupRequestSchema.safeParse({ action: "date", copyId: "c", version: 1, acquiredOn: null }).success, true);
  assert.equal(cleanupRequestSchema.safeParse({ action: "apply-cover", copyId: "c", version: 1, artwork: { url: "http://example.com/a.jpg" } }).success, false);
});
