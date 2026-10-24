import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import type { DrizzleSQLiteSnapshotJSON } from 'drizzle-kit/api';
import * as schema from '../src/server/db/schema/index.ts';
import { migrationFiles } from './lib/migrations.ts';

// Ignore SQL formatting/identifier quotes, while preserving string literals.
function canonicalSql(sql: string) {
  return (sql.match(/'(?:[^']|'')*'|[a-z_][a-z0-9_]*|[^\s"`]/gi) ?? [])
    .map(token => token.startsWith("'") ? token : token.toLowerCase()).join(' ');
}

function checks(sql: string) {
  const result: string[] = [];
  const start = /\bCHECK\s*\(/gi;
  for (const match of sql.matchAll(start)) {
    const offset = match.index + match[0].length;
    let depth = 1;
    let quoted = false;
    let end = offset;
    for (; end < sql.length && depth; end++) {
      const character = sql[end];
      if (character === "'") {
        if (quoted && sql[end + 1] === "'") { end++; continue; }
        quoted = !quoted;
      } else if (!quoted) {
        if (character === '(') depth++;
        if (character === ')') depth--;
      }
    }
    assert.equal(depth, 0, 'Unclosed CHECK constraint');
    result.push(canonicalSql(sql.slice(offset, end - 1)));
  }
  return result.sort();
}

function describe(db: DatabaseSync) {
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string; sql: string }[];
  return tables.map(({ name, sql }) => {
    const identifier = `"${name.replaceAll('"', '""')}"`;
    const indexes = db.prepare(`PRAGMA index_list(${identifier})`).all()
      .map(({ seq: _seq, ...index }) => ({
        ...index,
        name: String(index.name),
        columns: db.prepare(`PRAGMA index_info("${String(index.name).replaceAll('"', '""')}")`).all(),
        sql: canonicalSql(String(db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(index.name!)?.sql ?? '')),
      })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return {
      name,
      columns: db.prepare(`PRAGMA table_info(${identifier})`).all(),
      foreignKeys: db.prepare(`PRAGMA foreign_key_list(${identifier})`).all(),
      indexes,
      checks: checks(sql),
    };
  });
}

// The latest snapshot describes the typed schema after every reviewed migration.
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { idx: number; tag: string }[] };
const latest = journal.entries.at(-1)!;
const migrations = await migrationFiles();
assert.deepEqual(migrations.map(m => m.name), journal.entries.map(e => `${e.tag}.sql`), 'Migration files differ from the Drizzle journal');
const snapshot: DrizzleSQLiteSnapshotJSON = JSON.parse(await readFile(`drizzle/meta/${String(latest.idx).padStart(4, '0')}_snapshot.json`, 'utf8'));
const current = await generateSQLiteDrizzleJson(schema, snapshot.id);
assert.deepEqual(JSON.parse(JSON.stringify(current.tables)), snapshot.tables, 'Typed schema differs from the established baseline snapshot');
assert.deepEqual(JSON.parse(JSON.stringify(current.views)), snapshot.views, 'Views differ from the baseline snapshot');
const statements = await generateSQLiteMigration({ ...snapshot, tables: {}, views: {} }, snapshot);
const reviewed = new DatabaseSync(':memory:');
const generated = new DatabaseSync(':memory:');
try {
  for (const { sql } of migrations) reviewed.exec(sql);
  for (const statement of statements) generated.exec(statement);
  const actual = describe(reviewed);
  assert.equal(actual.length, 27);
  assert.deepEqual(actual, describe(generated), 'Reviewed migrations differ from Drizzle-generated SQL');
  assert.deepEqual(reviewed.prepare('SELECT * FROM collection_state').all().map(row => ({ ...row })), [{ id: 1, revision: 0 }]);
  console.log(`Schema parity passed: 27 tables after ${migrations.length} reviewed migrations; columns, defaults, keys, indexes, CHECK constraints and the ${latest.tag} snapshot agree.`);
  console.log('The reviewed baseline additionally initializes collection_state to revision 0.');
} finally {
  reviewed.close();
  generated.close();
}
