import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openSqlite, migrateSqlite } from '../../scripts/lib/sqlite.ts';
import { normalizeCsv } from '../../scripts/lib/normalize.ts';
import { persistPlan, ReconciliationRequired } from '../../scripts/lib/import.ts';
import { verifySeed } from '../../scripts/lib/verify.ts';
import { seedTestCds, TEST_CD_COUNT } from '../helpers/test-cds.ts';
import { migrationFiles } from '../../scripts/lib/migrations.ts';
import { collectionSummary } from '../../src/server/services/collection-summary.ts';
import { renderDiagnostic } from '../../scripts/lib/diagnostic.ts';
import type { Database } from '../../scripts/lib/types.ts';

const csv = readFileSync('initial_collection.csv', 'utf8');
const plan = normalizeCsv(csv);
async function database() { const db = openSqlite(':memory:'); await migrateSqlite(db); return db; }
const summary = (db: Database) => collectionSummary(sql => db.all(sql));
const statement = (sql: string, params: (string | number | null)[] = []) => ({ sql, params });

test('actual SQL migration creates 29 tables (27 normalized + request limits + logged hauls), enforces FKs and is repeatable', async () => {
  const db = await database();
  try {
    await migrateSqlite(db);
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_offline_%'");
    assert.equal(tables.length, 29);
    assert.equal((await db.all('PRAGMA foreign_keys'))[0]!.foreign_keys, 1);
    await assert.rejects(db.batch([statement("INSERT INTO volumes(item_id, volume_edition_id) VALUES ('missing-item', 'missing-edition')")]));
    await assert.rejects(db.batch([statement("INSERT INTO collection_items(id, media_kind, acquisition_batch_id) VALUES ('orphan-haul-copy', 'manga', 'missing-haul')")]));
    await assert.rejects(db.batch([statement("INSERT INTO collection_items(id, media_kind, notes_private) VALUES ('bad-privacy', 'manga', 2)")]));
  } finally { await db.close(); }
});
test('persisted normalized data passes independent aggregate and FK/subtype verification', async () => {
  const db = await database();
  try {
    assert.equal((await persistPlan(db, plan)).status, 'imported');
    await verifySeed(db);
    assert.equal((await db.all('SELECT COUNT(*) AS n FROM volume_editions'))[0]!.n, 176);
    const copies = await db.all('SELECT i.acquired_on, v.volume_edition_id FROM volumes v JOIN collection_items i ON i.id = v.item_id WHERE i.id IN (?, ?)', [plan.copies[157]!.itemId, plan.copies[172]!.itemId]);
    assert.equal(copies.length, 2); assert.equal(copies[0]!.volume_edition_id, copies[1]!.volume_edition_id);
    assert.ok(copies.some(c => c.acquired_on === null));
  } finally { await db.close(); }
});
test('identical reimport changes no table, revision, timestamps, catalog metadata, or owner edits', async () => {
  const db = await database();
  try {
    await persistPlan(db, plan);
    await db.batch([
      statement('UPDATE collection_items SET notes = ?, acquired_on = ?, version = 2 WHERE id = ?', ['owner edit', '2025-02-03', plan.copies[0]!.itemId]),
      statement('UPDATE creators SET display_name = ? WHERE id = ?', ['Owner-confirmed credit', plan.copies[0]!.creatorId]),
    ]);
    const snapshot = async () => {
      const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
      return Promise.all(tables.map(async row => [row.name, await db.all(`SELECT * FROM ${row.name} ORDER BY rowid`)]));
    };
    const before = await snapshot();
    assert.equal((await persistPlan(db, plan)).status, 'already-imported');
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.all('SELECT revision FROM collection_state'))[0]!.revision, 1);
  } finally { await db.close(); }
});
test('changed source bytes and mapping versions require reconciliation without writing records', async () => {
  const db = await database();
  try {
    await persistPlan(db, plan);
    for (const candidate of [normalizeCsv(csv + '\n'), { ...plan, mappingVersion: 'v2' }]) {
      await assert.rejects(persistPlan(db, candidate), ReconciliationRequired);
      assert.equal((await db.all('SELECT COUNT(*) AS n FROM collection_items'))[0]!.n, 177);
      assert.equal((await db.all('SELECT COUNT(*) AS n FROM import_batches'))[0]!.n, 1);
    }
  } finally { await db.close(); }
});
test('incomplete imports remain invisible and resume without duplicate copies', async () => {
  const db = await database();
  try {
    let chunks = 0;
    const interrupted: Database = { ...db, batch: async statements => {
      if (++chunks === 25) throw new Error('simulated interruption');
      await db.batch(statements);
    } };
    await assert.rejects(persistPlan(interrupted, plan), /simulated interruption/);
    assert.ok(Number((await db.all('SELECT COUNT(*) AS n FROM collection_items'))[0]!.n) > 0);
    assert.equal((await summary(db)).physicalCopies, 0);
    assert.equal((await db.all('SELECT revision FROM collection_state'))[0]!.revision, 0);
    await persistPlan(db, plan);
    await verifySeed(db);
    assert.equal((await db.all('SELECT revision FROM collection_state'))[0]!.revision, 1);
  } finally { await db.close(); }
});
test('failed atomic batches roll back successful earlier statements', async () => {
  const db = await database();
  try {
    await assert.rejects(db.batch([
      statement("INSERT INTO publishers(id, name, normalized_name) VALUES ('rollback', 'A', 'a')"),
      statement("INSERT INTO edition_runs(id,series_id,edition_title,language,language_basis,format,numbering_basis) VALUES ('bad','absent','Bad','EN','specified','standard','printed')"),
    ]));
    assert.deepEqual(await db.all("SELECT * FROM publishers WHERE id = 'rollback'"), []);
  } finally { await db.close(); }
});
test('subtype foreign keys reject manga/CD mismatches and permit legitimate repeated ownership', async () => {
  const db = await database();
  try {
    await persistPlan(db, plan); await seedTestCds(db);
    const cd = (await db.all('SELECT item_id FROM cds LIMIT 1'))[0]!.item_id as string;
    const release = (await db.all('SELECT id FROM album_releases LIMIT 1'))[0]!.id as string;
    await assert.rejects(db.batch([statement('INSERT INTO volumes(item_id, volume_edition_id) VALUES (?, ?)', [cd, plan.copies[0]!.volumeEditionId])]));
    await assert.rejects(db.batch([statement('INSERT INTO cds(item_id, release_id) VALUES (?, ?)', [plan.copies[0]!.itemId, release])]));
    await db.batch([
      statement("INSERT INTO collection_items(id, media_kind) VALUES ('extra-copy', 'manga')"),
      statement('INSERT INTO volumes(item_id, volume_edition_id) VALUES (?, ?)', ['extra-copy', plan.copies[0]!.volumeEditionId]),
    ]);
    assert.equal((await summary(db)).physicalCopies, 178);
    assert.equal((await summary(db)).uniqueSeries, 38);
  } finally { await db.close(); }
});
test('database constraints reject invalid enums, dates, booleans, versions and duplicate volume numbering', async () => {
  const db = await database();
  try {
    await persistPlan(db, plan);
    for (const sql of [
      "UPDATE edition_runs SET language = 'FR'", "UPDATE edition_runs SET language_basis = 'guess'",
      "UPDATE collection_items SET version = 0",
      "UPDATE collection_items SET acquired_on = '2024-02-30'", "UPDATE collection_items SET acquired_on = '2024-13-01'",
      "UPDATE collection_items SET acquired_on = '1/2/2024'", "UPDATE volumes SET media_kind = 'cd'",
    ]) await assert.rejects(db.batch([statement(sql)]), sql);
    await assert.rejects(db.batch([statement('INSERT INTO volume_editions(id, edition_run_id, volume_label, numbering_key) VALUES (?, ?, ?, ?)', ['duplicate-number', plan.copies[0]!.editionRunId, '1', '1'])]));
    await verifySeed(db);
  } finally { await db.close(); }
});
test('multiple creator credits and item tags do not multiply ownership aggregates', async () => {
  const db = await database();
  try {
    await persistPlan(db, plan);
    await db.batch([
      statement("INSERT INTO creators(id,display_name,search_key,kind) VALUES ('second-author','Test','test','person')"),
      statement("INSERT INTO series_creators(series_id,creator_id,role,credit_order) VALUES (?,'second-author','artist',1)", [plan.copies[0]!.seriesId]),
    ]);
    await verifySeed(db);
  } finally { await db.close(); }
});
test('migration 0005 deletes retired sample CDs and their tags without touching owned copies', async () => {
  const db = await database();
  try {
    await persistPlan(db, plan); await seedTestCds(db);
    const release = (await db.all('SELECT id FROM album_releases LIMIT 1'))[0]!.id as string;
    await db.batch([
      statement("INSERT INTO collection_items(id, media_kind, is_sample) VALUES ('old-sample', 'cd', 1)"),
      statement("INSERT INTO cds(item_id, release_id) VALUES ('old-sample', ?)", [release]),
      statement("INSERT INTO tags(id, slug, label, category) VALUES ('t', 'test-gifts', 'Test gifts', 'memory')"),
      statement("INSERT INTO item_tags(item_id, tag_id, source) VALUES ('old-sample', 't', 'manual')"),
    ]);
    const revision = async () => (await db.all('SELECT revision FROM collection_state'))[0]!.revision as number;
    const before = await revision();
    const migration = (await migrationFiles()).find(file => file.name === '0005_remove_sample_cds.sql')!;
    await db.batch(migration.sql.split('--> statement-breakpoint').map(sql => statement(sql.replace(/^--.*$/gm, '').trim())).filter(s => s.sql));
    assert.deepEqual(await db.all("SELECT id FROM collection_items WHERE id = 'old-sample'"), []);
    assert.deepEqual(await db.all("SELECT item_id FROM item_tags WHERE item_id = 'old-sample'"), []);
    const s = await verifySeed(db); assert.equal(s.personalCds, TEST_CD_COUNT);
    assert.equal(await revision(), before + 1, 'cached shelves refresh');
  } finally { await db.close(); }
});
test('CD schema supports artists, labels, preserved catalog numbers, multi-disc formats and ordered tracklists', async () => {
  const db = await database();
  try {
    await seedTestCds(db);
    const release = (await db.all('SELECT id FROM album_releases LIMIT 1'))[0]!.id as string;
    await db.batch([
      statement("INSERT INTO labels(id,name,normalized_name) VALUES ('test-label','Synthetic label','synthetic label')"),
      statement("INSERT INTO release_labels(id,release_id,label_id,catalog_number,credit_order) VALUES ('credit',?,'test-label','0001-ABC',0)", [release]),
      statement("INSERT INTO release_media(id,release_id,position,format) VALUES ('disc',?,1,'CD')", [release]),
      statement("INSERT INTO release_media(id,release_id,position,format) VALUES ('video',?,2,'Blu-ray')", [release]),
      statement("INSERT INTO tracks(id,medium_id,position,title,duration_ms) VALUES ('track2','disc',2,'Synthetic second',NULL)"),
      statement("INSERT INTO tracks(id,medium_id,position,title,duration_ms) VALUES ('track1','disc',1,'Synthetic first',123000)"),
    ]);
    assert.deepEqual((await db.all('SELECT title FROM tracks ORDER BY position')).map(r => r.title), ['Synthetic first', 'Synthetic second']);
    assert.equal((await db.all('SELECT catalog_number FROM release_labels'))[0]!.catalog_number, '0001-ABC');
    await assert.rejects(db.batch([statement("INSERT INTO tracks(id,medium_id,position,title) VALUES ('duplicate','disc',1,'Duplicate')")]));
    await assert.rejects(db.batch([statement('UPDATE tracks SET duration_ms = -1')]));
    await assert.rejects(db.batch([statement("UPDATE album_releases SET release_date = '2024', date_precision = NULL")]));
    await db.batch([statement("UPDATE album_releases SET release_date = '2024', date_precision = 'year'")]);
  } finally { await db.close(); }
});
test('optional artwork metadata enforces a single delivery location and actual external reference targets', async () => {
  const db = await database();
  try {
    await db.batch([statement("INSERT INTO cover_assets(id,provider,storage_mode,status,match_scope,policy_version) VALUES ('asset','synthetic','r2','pending','edition','test')")]);
    await assert.rejects(db.batch([statement("INSERT INTO cover_variants(id,cover_asset_id,variant,mime_type) VALUES ('variant','asset','grid','image/webp')")]));
    await db.batch([statement("INSERT INTO cover_variants(id,cover_asset_id,variant,mime_type,object_key) VALUES ('variant','asset','grid','image/webp','synthetic/grid.webp')")]);
    await assert.rejects(db.batch([statement("UPDATE cover_variants SET external_url = 'https://example.com/image.webp'")]));
    await assert.rejects(db.batch([statement("INSERT INTO external_refs(id,provider,provider_entity_type,external_id,source_url,fetched_at,match_basis) VALUES ('ref','synthetic','series','1','https://example.com','2026-01-01','test')")]));
  } finally { await db.close(); }
});
test('SQL values stay bound: apostrophes and SQL-looking notes are harmless literal text', async () => {
  const db = await database();
  try {
    const note = "owner's note'); DROP TABLE series; --";
    const changed = normalizeCsv(csv.replace('first b&n manga trip', note));
    await persistPlan(db, changed);
    assert.equal((await db.all('SELECT notes FROM collection_items WHERE id = ?', [changed.copies[1]!.itemId]))[0]!.notes, note);
    assert.equal((await summary(db)).uniqueSeries, 38);
  } finally { await db.close(); }
});
test('single-source unique constraint prevents competing initial imports from bypassing reconciliation', async () => {
  const db = await database();
  try {
    await persistPlan(db, plan);
    await assert.rejects(db.batch([statement("INSERT INTO import_batches(id,source_kind,source_filename,source_sha256,mapping_version,status) VALUES ('competing','initial-collection','other.csv','other-hash','v1','committing')")]));
  } finally { await db.close(); }
});

test('development diagnostic renders actual changing database counts and escapes stored text', async () => {
  const db = await database();
  try {
    assert.match(renderDiagnostic(await summary(db)), /Physical manga copies<\/dt><dd>0<\/dd>/);
    await persistPlan(db, plan);
    assert.match(renderDiagnostic(await summary(db)), /Physical manga copies<\/dt><dd>177<\/dd>/);
    await db.batch([
      statement("INSERT INTO collection_items(id, media_kind) VALUES ('diagnostic-copy', 'manga')"),
      statement('INSERT INTO volumes(item_id, volume_edition_id) VALUES (?, ?)', ['diagnostic-copy', plan.copies[0]!.volumeEditionId]),
      statement('UPDATE publishers SET name = ? WHERE id = ?', ['<script>alert(1)</script>', plan.copies[0]!.publisherId]),
    ]);
    const html = renderDiagnostic(await summary(db));
    assert.match(html, /Physical manga copies<\/dt><dd>178<\/dd>/);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>'));
  } finally { await db.close(); }
});
