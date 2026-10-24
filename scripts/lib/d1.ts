import type { Database, Value } from './types.ts';

/** All CLI D1 access is local. No remote flag or credential path is implemented. */
export async function openLocalD1(persistPath = '.wrangler/state/v3'): Promise<Database> {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'wrangler.toml', persist: { path: persistPath } });
  const binding = proxy.env.DB;
  return {
    async all<T extends Record<string, unknown>>(sql: string, params: Value[] = []) {
      const result = await binding.prepare(sql).bind(...params).all<T>();
      if (!result.success) throw new Error('D1 query failed');
      return result.results;
    },
    async batch(statements) {
      if (statements.length) await binding.batch(statements.map(s => binding.prepare(s.sql).bind(...s.params)));
    },
    async close() { await proxy.dispose(); },
  };
}

/** Local D1 plus the COVERS R2 binding and vars, for the cover-cache utility. */
export async function openLocalPlatform(persistPath = '.wrangler/state/v3') {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database; COVERS?: R2Bucket; METADATA_CONTACT?: string }>({ configPath: 'wrangler.toml', persist: { path: persistPath } });
  const binding = proxy.env.DB;
  const db: Database = {
    async all<T extends Record<string, unknown>>(sql: string, params: Value[] = []) {
      const result = await binding.prepare(sql).bind(...params).all<T>();
      if (!result.success) throw new Error('D1 query failed');
      return result.results;
    },
    async batch(statements) {
      if (statements.length) await binding.batch(statements.map(s => binding.prepare(s.sql).bind(...s.params)));
    },
    async close() { await proxy.dispose(); },
  };
  return { db, bucket: proxy.env.COVERS, contact: proxy.env.METADATA_CONTACT };
}
