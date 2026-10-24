import test from "node:test";
import assert from "node:assert/strict";
import type { CdAlbum, MangaCopy, MangaSeries } from "../../src/domain/library.ts";
import { seriesGaps, browseParams, parseBrowseState, defaultBrowseState } from "../../src/domain/library.ts";
import { acquisitions, calendarLabel, collectionAnalytics, emptyTimelineFilters, haulTimeline } from "../../src/domain/collection-insights.ts";

const copy = (volume: string, extra: Partial<MangaCopy> = {}): MangaCopy => ({
  id: `copy-${volume}`, editionRunId: "run", editionTitle: "Story", language: "EN", languageBasis: "confirmed", publisher: "House", volume, volumeSort: null, numberingBasis: "printed", medium: "manga", format: "standard", acquiredOn: "2024-02-29", notes: null, tags: [], ...extra,
});
const series = (copies: MangaCopy[]): MangaSeries => ({kind: "manga", id: "series", title: "Story", authors: ["Writer", "Artist", "Writer"], aliases: [], copies});
const cd: CdAlbum = { kind: "cd", id: "album", title: "Album", releaseId: "release", artists: [], releaseDate: null, formats: ["CD", "CD"], labels: [], catalogNumbers: [], tracks: [], copies: [
  { id: "cd-1", acquiredOn: "2024-02-29", notes: "gift <3", isSample: false, tags: ["Gifts"] },
  { id: "cd-2", acquiredOn: null, notes: null, isSample: false },
  { id: "sample", acquiredOn: "2099-01-01", notes: "sample", isSample: true },
] };

test("timeline combines all personal media by exact date, preserves copies and notes, puts unknown dates last", () => {
  const entry = series([copy("1", { notes: "first bookstore <3", tags: ["Trips"] }), copy("1", {id: "duplicate"}), copy("3", {acquiredOn: "2024-03-01"}), copy("5", { acquiredOn: null })]);
  const items = acquisitions([entry, cd]);
  const hauls = haulTimeline(items);
  assert.deepEqual(hauls.map(haul => [haul.date, haul.items.length]), [["2024-03-01", 1], ["2024-02-29", 3], [null, 2]]);
  assert.equal(hauls[1]!.items.find(item => item.copy.id === "copy-1")!.copy.notes, "first bookstore <3");
  assert.equal(items.length, 6);
  assert.equal(haulTimeline(items, {...emptyTimelineFilters, media: "cd"})[0]!.items.length, 1);
  assert.deepEqual(haulTimeline(items, {...emptyTimelineFilters, year: "unknown"})[0]!.items.map(item => item.copy.id), ["cd-2", "copy-5"]);
  assert.equal(haulTimeline(items, {...emptyTimelineFilters, memory: "Trips", media: "cd"}).length, 0);
  assert.equal(haulTimeline(items, {...emptyTimelineFilters, memory: "Trips", year: "2024"})[0]!.items.length, 1);
  assert.deepEqual(haulTimeline(items, {...emptyTimelineFilters, year: "2023"}), []);
});

test("analytics counts records, canonical series and multi-disc CD copies, excludes samples, keeps unknown dates", () => {
  const entry = series([copy("1"), copy("1", {id: "duplicate"}), copy("3", { language: "JP", editionRunId: "jp" }), copy("4", {medium: "light_novel", acquiredOn: null})]);
  const stats = collectionAnalytics([entry, cd, {...entry, kind: "book", id: "book", copies: [copy("1", {medium: "book"})]}]);
  assert.deepEqual([stats.mangaCopies, stats.uniqueSeries, stats.cds, stats.samples, stats.books, stats.lightNovels, stats.undated], [4, 1, 2, 1, 1, 1, 2]);
  assert.deepEqual(stats.languages, [{label: "EN", count: 3}, {label: "JP", count: 1}]);
  assert.deepEqual(stats.cdYears, [{label: "2024", count: 1}, {label: "Unknown date", count: 1}]);
  assert.deepEqual(stats.authors, [{label: "Artist", count: 4}, {label: "Writer", count: 4}]);
  assert.equal(stats.mostCollected[0]!.count, 4);
  assert.equal(stats.largestHauls[0]!.items.length, 5);
  assert.deepEqual(collectionAnalytics([]).largestHauls, []);
  assert.equal(collectionAnalytics([]).mangaCopies, 0);
});

test("gap groups defensively separate inconsistent edition, language, publisher, format, medium and special-edition tags", () => {
  for (const extra of [{editionRunId: "other"}, {editionTitle: "Special"}, {language: "JP" as const}, {publisher: "Other"}, {format: "collectors"}, {medium: "light_novel" as const}, {tags: ["Collector's Edition"]}]) {
    const groups = seriesGaps(series([copy("1"), copy("3", extra)]));
    assert.equal(groups.length, 2, JSON.stringify(extra));
    assert.ok(groups.every(group => group.missing.length === 0));
  }
});

test("gap detector withholds incomplete or non-sequential metadata including ambiguous omnibus and special labels", () => {
  for (const extra of [{editionRunId: ""}, {editionTitle: ""}, {publisher: "Unknown publisher"}, {format: "unknown"}, {numberingBasis: "source_record" as const}, {numberingBasis: "unknown" as const}, {volume: "1–3"}, {volume: "Special"}, {volume: "1.5"}, {volume: "-1"}, {volume: "0"}, {volume: "9007199254740992"}, {notes: "omnibus"}, {tags: ["Omnibus"]}]) {
    const groups = seriesGaps(series([copy("1", extra), copy("8", extra)]));
    assert.ok(groups.every(group => group.uncertain && !group.missing.length), JSON.stringify(extra));
  }
});

test("printed omnibus sequence compares package numbers; ranges, duplicates and extremes never expand into huge arrays", () => {
  assert.deepEqual(seriesGaps(series([copy("1", {format: "omnibus"}), copy("3", {format: "omnibus"})]))[0]!.missing, ["2"]);
  const group = seriesGaps(series([copy("9"), copy("1"), copy("3"), copy("03"), copy("1", {id: "duplicate"})]))[0]!;
  assert.deepEqual(group.missing, ["2", "4–8"]);
  assert.deepEqual(group.ranges, [{start: 2, end: 2, count: 1}, {start: 4, end: 8, count: 5}]);
  assert.equal(collectionAnalytics([series([copy("1"), copy("9007199254740991")])]).gaps[0]!.count, 9007199254740989);
  assert.deepEqual(seriesGaps(series([])), []);
});

test("date display is timezone independent and preserves early calendar years; panel links round-trip", () => {
  assert.equal(calendarLabel("2024-02-29"), "February 29, 2024");
  assert.equal(calendarLabel("0001-01-01"), "January 1, 1");
  for (const section of ["timeline", "stats"] as const) {
    const state = {...defaultBrowseState, section, item: "series"};
    assert.deepEqual(parseBrowseState(browseParams(state)), state);
  }
});

test("interleaved formats and languages cannot bridge a printed edition gap, even when a run ID is reused", () => {
  const groups = seriesGaps(series([
    copy("1"), copy("4"), copy("4", {id: "duplicate"}),
    copy("2", {language: "JP"}), copy("3", {format: "omnibus"}),
    copy("2", {format: "collectors"}), copy("3", {medium: "light_novel"}),
  ]));
  assert.deepEqual(groups[0]!.missing, ["2–3"]);
  assert.ok(groups.slice(1).every(group => !group.missing.length));
});

test("every reported range is bounded by owned numbers and independent of acquisition chronology", () => {
  // Exhaust all ownership subsets of a small sequence, with out-of-order duplicate copies.
  for (let mask = 1; mask < 256; mask++) {
    const owned = new Set(Array.from({length: 8}, (_, i) => i + 1).filter(n => mask & (1 << (n - 1))));
    const copies = [...owned].reverse().flatMap(n => [copy(String(n)), copy(String(n), {id: `duplicate-${n}`, acquiredOn: null})]);
    const groups = seriesGaps(series(copies));
    const reported = new Set(groups[0]!.ranges.flatMap(range => Array.from({length: range.count}, (_, i) => range.start + i)));
    for (let n = 1; n <= 8; n++) {
      const observed = n > Math.min(...owned) && n < Math.max(...owned) && !owned.has(n);
      assert.equal(reported.has(n), observed, `ownership ${mask}, number ${n}`);
    }
  }
});
