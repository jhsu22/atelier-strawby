import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "strawby-migrations-"));
const run = (args: string[]) => {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", ...args, "--local", "--persist-to", directory], {encoding: "utf8", env: {...process.env, WRANGLER_SEND_METRICS: "false"}});
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
};
try {
  run(["migrations", "apply", "DB"]);
  const repeat = run(["migrations", "apply", "DB"]);
  assert.match(repeat, /No migrations to apply/);
  const results = JSON.parse(run(["execute", "DB", "--command", "PRAGMA foreign_key_check; SELECT name FROM d1_migrations ORDER BY id; SELECT name FROM sqlite_master WHERE name IN ('request_limits','acquisition_batches') ORDER BY name; SELECT name, dflt_value FROM pragma_table_info('collection_items') WHERE name='notes_private';", "--json"])) as {results: Record<string, unknown>[]}[];
  assert.deepEqual(results[0]!.results, []);
  assert.deepEqual(results[1]!.results.map(row => row.name), ["0000_foundation.sql", "0001_edition_medium.sql", "0002_request_limits.sql", "0003_private_notes.sql", "0004_acquisition_batches.sql"]);
  assert.deepEqual(results[2]!.results.map(row => row.name), ["acquisition_batches", "request_limits"]);
  assert.deepEqual(results[3]!.results, [{ name: "notes_private", dflt_value: "1" }]);
  console.log("PASS: Wrangler applied all five migrations, recorded its journal, repeated without changes, and passed foreign-key checks on disposable D1.");
} finally { await rm(directory, {recursive: true, force: true}); }
