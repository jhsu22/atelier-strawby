import test from "node:test";
import assert from "node:assert/strict";
import { compareReleases, publicationDate } from "../../src/domain/releases.ts";
import { releaseNumber } from "../../src/server/metadata/releases.ts";
import type { ReleaseCatalog } from "../../src/domain/releases.ts";
import type { MangaCopy } from "../../src/domain/library.ts";

test("publication evidence uses validated calendar dates and conservative month/year ends", () => {
  assert.deepEqual(publicationDate("2024-02"), {date: "2024-02-29", precision: "month"});
  assert.deepEqual(publicationDate("2025"), {date: "2025-12-31", precision: "year"});
  assert.deepEqual(publicationDate("September 9, 2025"), {date: "2025-09-09", precision: "day"});
  assert.deepEqual(publicationDate("September 2025"), {date: "2025-09-30", precision: "month"});
  for (const value of ["2025-02-29", "2026-02-30", "2025-13", "0000", "tomorrow", "", "September 40, 2025"]) assert.equal(publicationDate(value), null, value);
});
test("release labels separate standard, special, omnibus package numbers and novel editions", () => {
  const standard = {format: "standard", medium: "manga" as const};
  assert.equal(releaseNumber("Story Vol. 12", ["Story"], standard), 12);
  for (const value of ["Story Omnibus Vol 2", "Story 3-in-1 Edition Vol 2", "Story (light novel) Vol 2", "Story Collector's Edition Vol 2", "Story: Sequel Vol 2", "Story Vol 1–3", "Story Vol 0"]) assert.equal(releaseNumber(value, ["Story"], standard), null, value);
  assert.equal(releaseNumber("Story Omnibus Vol 2", ["Story"], {...standard, format: "omnibus"}), 2);
  assert.equal(releaseNumber("Story 3-in-1 Edition Vol 2", ["Story"], {...standard, format: "omnibus"}), 2);
  assert.equal(releaseNumber("Story Collector's Edition Vol 2", ["Story"], {...standard, format: "collectors"}), 2);
  assert.equal(releaseNumber("Story Vol 2", ["Story"], {...standard, medium: "light_novel"}), null);
  assert.equal(releaseNumber("Story (light novel) Vol 2", ["Story"], {...standard, medium: "light_novel"}), 2);
});
test("released missing numbers require individual dated listings, ignore duplicate copies and other edition ownership, and never fill catalog holes", () => {
  const catalog: ReleaseCatalog = {editionRunId: "en", query: "Story", provider: "googlebooks", checkedAt: "2026-10-24T00:00:00Z", nextOffset: null, scanned: 5, excluded: 0, warnings: [], volumes: [1,2,4,4,8].map((number, i) => ({number, title: `Story ${number}`, sourceUrl: `https://books.google.com/books?id=${i}`, publishedOn: number === 8 ? "2030-01-01" : "2020-01-01", datePrecision: "day", provider: "googlebooks", digital: i === 3}))};
  const copy = (volume: string, run = "en", basis = "printed") => ({volume, editionRunId: run, numberingBasis: basis}) as MangaCopy;
  const result = compareReleases([copy("2"), copy("2"), copy("1", "jp"), copy("4", "en", "source_record")], catalog, "2026-10-24");
  assert.deepEqual(result.released.map(v => v.number), [1,2,4]);
  assert.deepEqual(result.missing.map(v => v.number), [1,4]);
  assert.deepEqual(result.owned.map(v => v.number), [2]);
  assert.equal(result.released.find(v => v.number === 4)!.digital, false);
});
