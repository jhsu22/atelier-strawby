import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCsv } from "../../scripts/lib/normalize.ts";
import { persistPlan } from "../../scripts/lib/import.ts";
import type { Database } from "../../scripts/lib/types.ts";
import { exportBackup } from "../../src/server/services/backup.ts";
import { createImportPreview, commitImport } from "../../src/server/services/transfer.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { browseEntries, defaultBrowseState } from "../../src/domain/library.ts";

export async function largeCollectionScenario(source: Database, restored: Database) {
  await persistPlan(source, normalizeCsv(readFileSync("initial_collection.csv", "utf8")));
  const backup = await exportBackup(source);
  const originals = structuredClone(backup.tables);
  for (let batch = 1; batch < 12; batch++) {
    for (const item of originals.collection_items!) backup.tables.collection_items!.push({ ...item, id: `${item.id}-${batch}`, idempotency_key: null, notes: `大きいコレクション 🍓 ${batch} ${"memory ".repeat(100)}` });
    for (const volume of originals.volumes!) backup.tables.volumes!.push({ ...volume, item_id: `${volume.item_id}-${batch}` });
    for (const tag of originals.item_tags!) backup.tables.item_tags!.push({ ...tag, item_id: `${tag.item_id}-${batch}` });
  }
  // Exports use primary-key order, so compare sorted data rather than fixture order.
  const text = JSON.stringify(backup);
  assert.ok(Buffer.byteLength(text) > 2_000_000, "exercise multiple D1 preview rows and restore parameters");
  const start = performance.now();
  const preview = await createImportPreview(restored, {kind: "json", filename: "large-backup.json", text});
  const chunks = await restored.all("SELECT payload_json FROM metadata_cache WHERE provider='import-preview'");
  assert.ok(chunks.length > 3);
  for (const row of chunks) assert.ok(Buffer.byteLength(String(row.payload_json)) < 1_000_000);
  // A missing chunk must fail before any physical copies are written.
  const chunk = (await restored.all("SELECT cache_key,payload_json FROM metadata_cache WHERE cache_key=?", [`import:${preview.token}:0`]))[0]!;
  await restored.batch([{sql: "DELETE FROM metadata_cache WHERE cache_key=?", params: [String(chunk.cache_key)]}]);
  await assert.rejects(commitImport(restored, preview.token, false), /incomplete/);
  assert.equal((await restored.all("SELECT COUNT(*) AS n FROM collection_items"))[0]!.n, 0);
  await restored.batch([{sql: "INSERT INTO metadata_cache(cache_key,provider,adapter_version,payload_json,status,fetched_at,expires_at) VALUES (?,'import-preview','1',?,'ready','2026-01-01','2099-01-01')", params: [String(chunk.cache_key), String(chunk.payload_json)]}]);
  const result = await commitImport(restored, preview.token, false);
  assert.equal(result.added, 2124);
  const restoreMs = performance.now() - start;
  const exported = await exportBackup(restored);
  const sorted = (rows: Record<string, unknown>[]) => rows.map(row => JSON.stringify(row)).sort();
  for (const table of Object.keys(backup.tables)) assert.deepEqual(sorted(exported.tables[table]!), sorted(backup.tables[table]!));
  const readStart = performance.now();
  const library = await libraryData(sql => restored.all(sql), { owner: true });
  const loadMs = performance.now() - readStart;
  assert.equal(library.entries.reduce((n, entry) => n + entry.copies.length, 0), 2124);
  const searchStart = performance.now();
  const results = browseEntries(library.entries, {...defaultBrowseState, query: "大きいコレクション"});
  assert.ok(results.length > 0);
  const searchMs = performance.now() - searchStart;
  assert.deepEqual(await restored.all("PRAGMA foreign_key_check"), []);
  console.log(JSON.stringify({copies: 2124, backupBytes: Buffer.byteLength(text), restoreMs: Math.round(restoreMs), loadMs: Math.round(loadMs), searchMs: Math.round(searchMs)}));
}
