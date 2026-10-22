import assert from 'node:assert/strict';
import { collectionSummary } from '../../src/server/services/collection-summary.ts';
import type { Database } from './types.ts';

export async function verifySeed(db: Database) {
  const summary = await collectionSummary(sql => db.all(sql));
  assert.equal(summary.physicalCopies, 177);
  assert.equal(summary.uniqueSeries, 38);
  assert.equal(summary.datedCopies, 172);
  assert.equal(summary.undatedCopies, 5);
  assert.equal(summary.distinctAcquisitionDates, 55);
  assert.equal(summary.recordsWithNotes, 97);
  assert.deepEqual(Object.fromEntries(summary.languages.map(r => [r.label, r.count])), { EN: 167, JP: 9, KR: 1 });
  assert.deepEqual(Object.fromEntries(summary.publishers.map(r => [r.label, r.count])), {
    Kodansha: 76, 'VIZ Media': 42, 'Yen Press': 33, 'Udon Entertainment': 9, Houbunsha: 4,
    Kadokawa: 4, 'DNA Media': 3, 'Seven Seas': 2, 'Kaiten Books': 2, 'Mag Garden': 1, 'Square Enix': 1,
  });
  assert.deepEqual(Object.fromEntries(summary.years.map(r => [r.label, r.count])), { 2021: 21, 2022: 96, 2023: 26, 2024: 29, unknown: 5 });
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
  const [orphans] = await db.all(`SELECT COUNT(*) AS count FROM collection_items i
    LEFT JOIN volumes v ON v.item_id = i.id LEFT JOIN cds c ON c.item_id = i.id
    WHERE (i.media_kind = 'manga' AND (v.item_id IS NULL OR c.item_id IS NOT NULL))
       OR (i.media_kind = 'cd' AND (c.item_id IS NULL OR v.item_id IS NOT NULL))`);
  assert.equal(orphans?.count, 0);
  const duplicates = await db.all('SELECT volume_edition_id, COUNT(*) AS copies FROM volumes GROUP BY volume_edition_id HAVING COUNT(*) > 1');
  assert.equal(duplicates.length, 1); assert.equal(duplicates[0]?.copies, 2);
  const [trace] = await db.all("SELECT COUNT(*) AS count FROM import_records WHERE status = 'imported'");
  assert.equal(trace?.count, 177);
  return summary;
}
