import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalD1 } from "../../scripts/lib/d1.ts";
import { migrationStatements } from "../../scripts/lib/migrations.ts";
import { largeCollectionScenario } from "../helpers/large-collection-scenario.ts";

test("real D1: a 2,124-copy multi-megabyte backup restores atomically with exact data integrity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strawby-large-"));
  const source = await openLocalD1(join(directory, "source")), restored = await openLocalD1(join(directory, "restored"));
  try {
    const migrations = await migrationStatements();
    for (const db of [source, restored]) for (let i = 0; i < migrations.length; i += 40) await db.batch(migrations.slice(i, i + 40));
    await largeCollectionScenario(source, restored);
  } finally { await source.close(); await restored.close(); await rm(directory, {recursive: true, force: true}); }
});
