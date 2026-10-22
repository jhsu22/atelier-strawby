import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { openSqlite } from '../../scripts/lib/sqlite.ts';

const run = promisify(execFile);
test('seed CLI preserves repeat imports and emits a reconciliation report without changing persisted ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'strawby-cli-'));
  const database = join(directory, 'collection.sqlite');
  const output = join(directory, 'artifacts');
  const args = ['--target', 'sqlite', '--database', database, '--output', output];
  try {
    await run(process.execPath, ['scripts/migrate-sqlite.ts', '--database', database]);
    const first = await run(process.execPath, ['scripts/seed-from-csv.ts', ...args]);
    assert.match(first.stdout, /status: 'imported'/);
    const artifact = await readFile(join(output, 'normalized-collection.json'), 'utf8');
    const edit = openSqlite(database);
    try { await edit.batch([{ sql: "UPDATE collection_items SET notes = 'owner edit'", params: [] }]); }
    finally { await edit.close(); }
    const repeat = await run(process.execPath, ['scripts/seed-from-csv.ts', ...args]);
    assert.match(repeat.stdout, /already-imported/);
    assert.equal(await readFile(join(output, 'normalized-collection.json'), 'utf8'), artifact);
    const candidate = join(directory, 'changed.csv');
    await writeFile(candidate, await readFile('initial_collection.csv', 'utf8') + '\n');
    await assert.rejects(run(process.execPath, ['scripts/seed-from-csv.ts', ...args, '--input', candidate]), /Reconciliation preview required/);
    const report = JSON.parse(await readFile(join(output, 'reconciliation-required.json'), 'utf8'));
    assert.equal(report.candidate.physicalCopies, 177);
    assert.match(report.proposedAction, /Review source changes/);
    const db = openSqlite(database);
    try {
      assert.equal((await db.all('SELECT COUNT(*) AS n FROM collection_items'))[0]!.n, 177);
      assert.equal((await db.all("SELECT COUNT(*) AS n FROM collection_items WHERE notes = 'owner edit'"))[0]!.n, 177);
      assert.equal((await db.all('SELECT COUNT(*) AS n FROM import_batches'))[0]!.n, 1);
      assert.equal((await db.all('SELECT revision FROM collection_state'))[0]!.revision, 1);
    } finally { await db.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
