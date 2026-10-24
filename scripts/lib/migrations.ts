import { readdir, readFile } from 'node:fs/promises';
import type { Statement } from './types.ts';

/** Reviewed migration files in the order Wrangler applies them. */
export async function migrationFiles(dir = 'drizzle'): Promise<{ name: string; sql: string }[]> {
  const names = (await readdir(dir)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
  return Promise.all(names.map(async name => ({ name, sql: await readFile(`${dir}/${name}`, 'utf8') })));
}
/** Every migration as individual statements for D1 batches. */
export async function migrationStatements(dir = 'drizzle'): Promise<Statement[]> {
  return (await migrationFiles(dir)).flatMap(({ sql }) => sql
    .split('--> statement-breakpoint')
    .map(s => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean)
    .map(sql => ({ sql, params: [] })));
}
