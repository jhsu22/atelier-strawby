import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import type { DrizzleSQLiteSnapshotJSON } from 'drizzle-kit/api';
import * as schema from '../src/server/db/schema/index.ts';

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

const snapshot: DrizzleSQLiteSnapshotJSON = JSON.parse(await readFile('drizzle/meta/0000_snapshot.json', 'utf8'));
const current = await generateSQLiteDrizzleJson(schema, snapshot.id);
assert.deepEqual(JSON.parse(JSON.stringify(current.tables)), snapshot.tables, 'Typed schema differs from the established baseline snapshot');
assert.deepEqual(JSON.parse(JSON.stringify(current.views)), snapshot.views, 'Views differ from the baseline snapshot');
const statements = await generateSQLiteMigration({ ...snapshot, tables: {}, views: {} }, snapshot);
const reviewed = new DatabaseSync(':memory:');
const generated = new DatabaseSync(':memory:');
try {
  reviewed.exec(await readFile('drizzle/0000_foundation.sql', 'utf8'));
  for (const statement of statements) generated.exec(statement);
  const actual = describe(reviewed);
  assert.equal(actual.length, 27);
  assert.deepEqual(actual, describe(generated), 'Reviewed migration differs from Drizzle-generated SQL');
  assert.deepEqual(reviewed.prepare('SELECT * FROM collection_state').all().map(row => ({ ...row })), [{ id: 1, revision: 0 }]);
  console.log('Schema parity passed: 27 tables; columns, defaults, keys, indexes, CHECK constraints and baseline snapshot agree.');
  console.log('The reviewed baseline additionally initializes collection_state to revision 0.');
} finally {
  reviewed.close();
  generated.close();
}
