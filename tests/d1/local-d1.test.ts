import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalD1 } from '../../scripts/lib/d1.ts';
import { normalizeCsv } from '../../scripts/lib/normalize.ts';
import { persistPlan, ReconciliationRequired } from '../../scripts/lib/import.ts';
import { seedTestCds, TEST_CD_COUNT } from '../helpers/test-cds.ts';
import type { Database } from '../../scripts/lib/types.ts';
import { verifySeed } from '../../scripts/lib/verify.ts';
import { collectionSummary } from '../../src/server/services/collection-summary.ts';
import { migrationStatements } from '../../scripts/lib/migrations.ts';

test('real local workerd D1: migration, import, repeat, owner edits, rollback, constraints and visibility', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'strawby-d1-'));
  try {
    const db = await openLocalD1(directory);
    try {
      const statements = await migrationStatements();
      for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
      const plan = normalizeCsv(await readFile('initial_collection.csv', 'utf8'));
      await persistPlan(db, plan); await verifySeed(db);
      await seedTestCds(db); await seedTestCds(db);
      const summary = await verifySeed(db);
      assert.equal(summary.personalCds, TEST_CD_COUNT);
      const cd = (await db.all('SELECT item_id FROM cds LIMIT 1'))[0]!.item_id as string;
      const release = (await db.all('SELECT id FROM album_releases LIMIT 1'))[0]!.id as string;
      await assert.rejects(db.batch([{ sql: 'INSERT INTO volumes(item_id,volume_edition_id) VALUES (?,?)', params: [cd, plan.copies[0]!.volumeEditionId] }]));
      await assert.rejects(db.batch([{ sql: 'INSERT INTO cds(item_id,release_id) VALUES (?,?)', params: [plan.copies[0]!.itemId, release] }]));
      await assert.rejects(db.batch([{ sql: "UPDATE collection_items SET acquired_on = '2024-02-30'", params: [] }]));
      const repeated = await db.all('SELECT volume_edition_id FROM volumes WHERE item_id IN (?,?)', [plan.copies[157]!.itemId, plan.copies[172]!.itemId]);
      assert.equal(repeated.length, 2);
      assert.equal(repeated[0]!.volume_edition_id, repeated[1]!.volume_edition_id);
      await db.batch([{ sql: 'UPDATE collection_items SET notes = ? WHERE id = ?', params: ['owner edit', plan.copies[0]!.itemId] }]);
      assert.equal((await persistPlan(db, plan)).status, 'already-imported');
      assert.equal((await db.all('SELECT notes FROM collection_items WHERE id = ?', [plan.copies[0]!.itemId]))[0]!.notes, 'owner edit');
      await assert.rejects(db.batch([
        { sql: "INSERT INTO publishers(id,name,normalized_name) VALUES ('rollback','Rollback','rollback')", params: [] },
        { sql: "INSERT INTO volumes(item_id,volume_edition_id) VALUES ('missing','missing')", params: [] },
      ]));
      assert.deepEqual(await db.all("SELECT id FROM publishers WHERE id = 'rollback'"), []);
      await assert.rejects(db.batch([{ sql: "UPDATE edition_runs SET language = 'invalid'", params: [] }]));
      await db.batch([{ sql: "UPDATE import_batches SET status = 'committing'", params: [] }]);
      assert.equal((await collectionSummary(sql => db.all(sql))).physicalCopies, 0);
    } finally { await db.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real local workerd D1: interrupted imports stay hidden, resume and refuse changed sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'strawby-d1-resume-'));
  try {
    const db = await openLocalD1(directory);
    try {
      const statements = await migrationStatements();
      for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
      const csv = await readFile('initial_collection.csv', 'utf8');
      const plan = normalizeCsv(csv);
      let chunks = 0;
      const interrupted: Database = { ...db, batch: async statements => {
        if (++chunks === 25) throw new Error('simulated interruption');
        await db.batch(statements);
      } };
      await assert.rejects(persistPlan(interrupted, plan), /simulated interruption/);
      assert.ok(Number((await db.all('SELECT COUNT(*) AS n FROM collection_items'))[0]!.n) > 0);
      assert.equal((await collectionSummary(sql => db.all(sql))).physicalCopies, 0);
      assert.equal((await db.all('SELECT revision FROM collection_state'))[0]!.revision, 0);
      await persistPlan(db, plan);
      await verifySeed(db);
      assert.equal((await db.all('SELECT revision FROM collection_state'))[0]!.revision, 1);
      for (const candidate of [normalizeCsv(csv + '\n'), { ...plan, mappingVersion: 'v2' }]) {
        await assert.rejects(persistPlan(db, candidate), ReconciliationRequired);
      }
      await verifySeed(db);
    } finally { await db.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
