import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Database } from "../../scripts/lib/types.ts";
import { normalizeCsv } from "../../scripts/lib/normalize.ts";
import { persistPlan } from "../../scripts/lib/import.ts";
import { parseCsv } from "../../src/domain/normalization/csv.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { saveItem, deleteItem } from "../../src/server/services/items.ts";
import { acquisitions, collectionAnalytics, haulTimeline } from "../../src/domain/collection-insights.ts";

const csv = readFileSync("initial_collection.csv", "utf8");
export async function insightsScenario(db: Database) {
  const plan = normalizeCsv(csv);
  await persistPlan(db, plan);
  const data = await libraryData(sql => db.all(sql), { owner: true });
  const stats = collectionAnalytics(data.entries);
  const timeline = haulTimeline(acquisitions(data.entries));
  assert.deepEqual([stats.mangaCopies, stats.uniqueSeries, stats.cds], [177, 38, 0]);
  assert.equal(stats.undated, 5);
  assert.equal(timeline.length, 56);
  // Independent grouping directly from the original CSV calendar cells, not normalized artifacts.
  const sourceDates = new Map<string | null, number>();
  for (const row of parseCsv(csv).slice(1)) {
    if (!row[0]?.trim()) continue;
    const [month, day, year] = (row[4] ?? "").split("/");
    const date = year ? `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}` : null;
    sourceDates.set(date, (sourceDates.get(date) ?? 0) + 1);
  }
  assert.equal([...sourceDates.values()].reduce((a, b) => a + b, 0), 177);
  for (const haul of timeline) assert.equal(haul.items.length, sourceDates.get(haul.date), haul.date ?? "unknown");
  // Per-copy dates and expanded memories reconcile with source provenance.
  const byId = new Map(acquisitions(data.entries).map(item => [item.copy.id, item.copy]));
  for (const source of plan.copies) {
    assert.equal(byId.get(source.itemId)!.acquiredOn, source.acquiredOn);
    assert.equal(byId.get(source.itemId)!.notes, source.notes);
  }
  const from = `FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id
    JOIN volumes v ON v.item_id=i.id JOIN volume_editions e ON e.id=v.volume_edition_id
    JOIN edition_runs r ON r.id=e.edition_run_id
    LEFT JOIN publishers p ON p.id=r.publisher_id
    WHERE (b.status='complete' OR i.import_batch_id IS NULL) AND r.medium IN ('manga','light_novel')`;
  const count = async (sql: string) => Number((await db.all(sql))[0]!.n);
  assert.equal(stats.mangaCopies, await count(`SELECT COUNT(*) n ${from}`));
  assert.equal(stats.uniqueSeries, await count(`SELECT COUNT(DISTINCT r.series_id) n ${from}`));
  for (const [actual, expr] of [[stats.languages, "r.language"], [stats.publishers, "COALESCE(p.name,'Unknown publisher')"], [stats.mangaYears, "COALESCE(substr(i.acquired_on,1,4),'Unknown date')"]] as const) {
    const rows = await db.all(`SELECT ${expr} label, COUNT(*) count ${from} GROUP BY ${expr}`);
    assert.deepEqual(Object.fromEntries(actual.map(row => [row.label, row.count])), Object.fromEntries(rows.map(row => [row.label, row.count])));
  }
  const topSeries = await db.all(`SELECT r.series_id id, COUNT(*) count ${from} GROUP BY r.series_id`);
  assert.deepEqual(Object.fromEntries(stats.mostCollected.map(row => [row.id, row.count])), Object.fromEntries(topSeries.map(row => [row.id, row.count])));
  const authors = await db.all(`SELECT c.display_name label, COUNT(DISTINCT i.id) count
    FROM collection_items i JOIN volumes v ON v.item_id=i.id
    JOIN volume_editions e ON e.id=v.volume_edition_id JOIN edition_runs r ON r.id=e.edition_run_id
    JOIN series_creators sc ON sc.series_id=r.series_id JOIN creators c ON c.id=sc.creator_id
    GROUP BY c.display_name`);
  assert.deepEqual(Object.fromEntries(stats.authors.map(row => [row.label, row.count])), Object.fromEntries(authors.map(row => [row.label, row.count])));
  const haulCounts = await db.all("SELECT acquired_on date, COUNT(*) count FROM collection_items WHERE acquired_on IS NOT NULL GROUP BY acquired_on ORDER BY count DESC, date DESC");
  assert.deepEqual(stats.largestHauls.map(haul => [haul.date, haul.items.length]), haulCounts.map(row => [row.date, row.count]));
  assert.equal(stats.gaps.find(gap => gap.series === "86: EIGHTY-SIX")!.count, 2);
  assert.ok(!stats.gaps.some(gap => gap.series === "Steins;Gate"));
  // Add real test-only persisted records, then read again: no precomputed or stale totals.
  const cd = await saveItem(db, { kind: "cd", title: "Test-only mixed haul CD", acquiredOn: "2021-09-18", notes: "Test-only gift", media: [{position: 1, format: "CD"}, {position: 2, format: "CD"}] });
  const second = await saveItem(db, { kind: "cd", title: "Test-only mixed haul CD", acquiredOn: null });
  const updated = await libraryData(sql => db.all(sql));
  const current = collectionAnalytics(updated.entries);
  assert.equal(current.cds, 2);
  assert.deepEqual(current.cdYears, [{label: "2021", count: 1}, {label: "Unknown date", count: 1}]);
  assert.equal(current.cds, await count("SELECT COUNT(*) n FROM collection_items WHERE media_kind='cd'"));
  assert.equal(haulTimeline(acquisitions(updated.entries)).find(haul => haul.date === "2021-09-18")!.items.length, 2);
  await deleteItem(db, cd.id, 1);
  await deleteItem(db, second.id, 1);
  assert.equal(collectionAnalytics((await libraryData(sql => db.all(sql))).entries).cds, 0);
}
