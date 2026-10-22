import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database, Statement, Value } from './types.ts';

/** Offline verification only. Production persistence and Astro reads use D1. */
export function openSqlite(path: string): Database & { raw: DatabaseSync } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON');
  return {
    raw,
    async all<T extends Record<string, unknown>>(sql: string, params: Value[] = []) { return raw.prepare(sql).all(...params) as T[]; },
    async batch(statements: Statement[]) {
      raw.exec('BEGIN IMMEDIATE');
      try { for (const { sql, params } of statements) raw.prepare(sql).run(...params); raw.exec('COMMIT'); }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
    async close() { raw.close(); },
  };
}
export async function migrateSqlite(db: ReturnType<typeof openSqlite>) {
  db.raw.exec('CREATE TABLE IF NOT EXISTS _offline_migrations (name TEXT PRIMARY KEY)');
  for (const name of readdirSync('drizzle').filter(x => x.endsWith('.sql')).sort()) {
    if ((await db.all('SELECT name FROM _offline_migrations WHERE name = ?', [name])).length) continue;
    db.raw.exec('BEGIN IMMEDIATE');
    try {
      db.raw.exec(readFileSync(`drizzle/${name}`, 'utf8'));
      db.raw.prepare('INSERT INTO _offline_migrations(name) VALUES (?)').run(name);
      db.raw.exec('COMMIT');
    } catch (error) { db.raw.exec('ROLLBACK'); throw error; }
  }
}
