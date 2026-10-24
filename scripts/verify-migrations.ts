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
  const results = JSON.parse(run(["execute", "DB", "--command", "PRAGMA foreign_key_check; SELECT name FROM d1_migrations ORDER BY id; SELECT name FROM sqlite_master WHERE name='request_limits';", "--json"])) as {results: Record<string, unknown>[]}[];
  assert.deepEqual(results[0]!.results, []);
  assert.deepEqual(results[1]!.results.map(row => row.name), ["0000_foundation.sql", "0001_edition_medium.sql", "0002_request_limits.sql", "0003_book_titles.sql"]);
  assert.deepEqual(results[2]!.results.map(row => row.name), ["request_limits"]);
  console.log("PASS: Wrangler applied all four migrations, recorded its journal, repeated without changes, and passed foreign-key checks on disposable D1.");
} finally { await rm(directory, {recursive: true, force: true}); }
