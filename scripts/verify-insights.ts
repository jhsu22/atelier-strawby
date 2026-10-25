import assert from "node:assert/strict";
import { openLocalD1 } from "./lib/d1.ts";
import { libraryData } from "../src/server/services/library.ts";
import { acquisitions, collectionAnalytics, haulTimeline } from "../src/domain/collection-insights.ts";

// Read the owner's current local D1 state. Never reseed to make a baseline pass.
const db = await openLocalD1();
try {
  const stats = collectionAnalytics((await libraryData(sql => db.all(sql), { owner: true })).entries);
  const visible = "(i.import_batch_id IS NULL OR b.status='complete')";
  const manga = `FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id
    JOIN volumes v ON v.item_id=i.id JOIN volume_editions e ON e.id=v.volume_edition_id
    JOIN edition_runs r ON r.id=e.edition_run_id LEFT JOIN publishers p ON p.id=r.publisher_id
    WHERE ${visible} AND r.medium IN ('manga','light_novel')`;
  const count = async (query: string) => Number((await db.all(query))[0]!.count);
  assert.equal(stats.mangaCopies, await count(`SELECT COUNT(*) count ${manga}`));
  assert.equal(stats.uniqueSeries, await count(`SELECT COUNT(DISTINCT r.series_id) count ${manga}`));
  assert.equal(stats.cds, await count(`SELECT COUNT(*) count FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id JOIN cds c ON c.item_id=i.id WHERE ${visible}`));
  assert.equal(stats.lightNovels, await count(`SELECT COUNT(*) count ${manga} AND r.medium='light_novel'`));
  assert.equal(stats.books, await count(`SELECT COUNT(*) count FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id JOIN volumes v ON v.item_id=i.id JOIN volume_editions e ON e.id=v.volume_edition_id JOIN edition_runs r ON r.id=e.edition_run_id WHERE ${visible} AND r.medium='book'`));
  assert.equal(stats.undated, await count(`SELECT COUNT(*) count FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id WHERE ${visible} AND i.acquired_on IS NULL`));
  const compare = async (actual: {label: string; count: number}[], query: string) => {
    const rows = await db.all(query);
    assert.deepEqual(Object.fromEntries(actual.map(row => [row.label, row.count])), Object.fromEntries(rows.map(row => [row.label, row.count])));
  };
  await compare(stats.languages, `SELECT r.language label, COUNT(*) count ${manga} GROUP BY r.language`);
  await compare(stats.publishers, `SELECT COALESCE(p.name,'Unknown publisher') label, COUNT(*) count ${manga} GROUP BY label`);
  await compare(stats.mangaYears, `SELECT COALESCE(substr(i.acquired_on,1,4),'Unknown date') label, COUNT(*) count ${manga} GROUP BY label`);
  await compare(stats.cdYears, `SELECT COALESCE(substr(i.acquired_on,1,4),'Unknown date') label, COUNT(*) count FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id JOIN cds c ON c.item_id=i.id WHERE ${visible} GROUP BY label`);
  const timeline = haulTimeline(acquisitions((await libraryData(sql => db.all(sql), { owner: true })).entries));
  const dates = await db.all(`SELECT i.acquired_on date, COUNT(*) count FROM collection_items i LEFT JOIN import_batches b ON b.id=i.import_batch_id WHERE ${visible} GROUP BY i.acquired_on`);
  assert.deepEqual(Object.fromEntries(timeline.map(haul => [haul.date ?? "unknown", haul.items.length])), Object.fromEntries(dates.map(row => [row.date ?? "unknown", row.count])));
  console.log(JSON.stringify({ verified: true, mangaCopies: stats.mangaCopies, uniqueSeries: stats.uniqueSeries, personalCds: stats.cds, books: stats.books, lightNovels: stats.lightNovels, languages: stats.languages, undatedCopies: stats.undated, acquisitionDates: stats.largestHauls.length, largestHaul: stats.largestHauls[0] ? {date: stats.largestHauls[0].date, copies: stats.largestHauls[0].items.length} : null }, null, 2));
} finally { await db.close(); }
