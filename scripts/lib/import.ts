import type { Database, SeedPlan, Statement, Value } from './types.ts';
import { assertImportable } from './normalize.ts';

const ORDER = ['publishers', 'creators', 'series', 'series_creators', 'series_aliases', 'edition_runs', 'volume_editions', 'tags', 'collection_items', 'volumes', 'item_tags', 'import_records'];
// Explicit conflict targets: a different uniqueness/FK/check failure must not be swallowed.
const KEYS: Record<string, string[]> = { series_creators: ['series_id', 'creator_id', 'role'], volumes: ['item_id'], item_tags: ['item_id', 'tag_id', 'source'] };
export function insertStatement(table: string, row: Record<string, Value>): Statement {
  if (!/^[a-z_][a-z_0-9]*$/.test(table) || Object.keys(row).some(k => !/^[a-z_][a-z_0-9]*$/.test(k))) throw new Error('Invalid SQL identifier');
  const columns = Object.keys(row);
  const keys = KEYS[table] ?? ['id'];
  return { sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT (${keys.join(', ')}) DO NOTHING`, params: Object.values(row) };
}
export function importStatements(plan: SeedPlan): Statement[] {
  return ORDER.flatMap(table => (plan.tables[table] ?? []).map(row => insertStatement(table, row)));
}

export class ReconciliationRequired extends Error {
  constructor() { super('Initial collection source or mapping version changed. Reconciliation preview required; no records were written.'); }
}
export async function persistPlan(db: Database, plan: SeedPlan, chunkSize = 40) {
  assertImportable(plan);
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 40) throw new Error('Batch size must be 1–40 statements');
  const batches = await db.all('SELECT id, source_sha256, mapping_version, status FROM import_batches WHERE source_kind = ?', ['initial-collection']);
  if (batches.some(b => b.source_sha256 !== plan.sourceSha256 || b.mapping_version !== plan.mappingVersion)) throw new ReconciliationRequired();
  if (batches.some(b => b.id === plan.batchId && b.status === 'complete')) return { status: 'already-imported' as const, copies: plan.copies.length };
  await db.batch([insertStatement('import_batches', { id: plan.batchId, source_kind: 'initial-collection', source_filename: plan.sourceFilename, source_sha256: plan.sourceSha256, mapping_version: plan.mappingVersion, status: 'committing' })]);
  const statements = importStatements(plan);
  for (let i = 0; i < statements.length; i += chunkSize) await db.batch(statements.slice(i, i + chunkSize));
  const [integrity] = await db.all<{ items: number; volumes: number; audits: number; skipped: number }>(`
    SELECT (SELECT COUNT(*) FROM collection_items WHERE import_batch_id = ?) AS items,
      (SELECT COUNT(*) FROM volumes v JOIN collection_items i ON i.id = v.item_id WHERE i.import_batch_id = ?) AS volumes,
      (SELECT COUNT(*) FROM import_records WHERE batch_id = ? AND status = 'imported' AND item_id IS NOT NULL) AS audits,
      (SELECT COUNT(*) FROM import_records WHERE batch_id = ? AND status = 'skipped') AS skipped`, Array(4).fill(plan.batchId));
  if (!integrity || integrity.items !== plan.copies.length || integrity.volumes !== plan.copies.length
    || integrity.audits !== plan.copies.length || integrity.skipped !== plan.skipped.length) throw new Error('Incomplete staged import; rerun to resume');
  // CAS status and revision in one D1 batch; repeat/concurrent finalization never increments twice.
  await db.batch([
    { sql: "UPDATE import_batches SET status = 'complete', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'committing'", params: [plan.batchId] },
    { sql: 'UPDATE collection_state SET revision = revision + 1 WHERE id = 1 AND changes() = 1', params: [] },
  ]);
  return { status: 'imported' as const, copies: integrity.items };
}
