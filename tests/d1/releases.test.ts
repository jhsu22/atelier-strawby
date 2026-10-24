import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalD1 } from "../../scripts/lib/d1.ts";
import { migrationStatements } from "../../scripts/lib/migrations.ts";
import { releasesScenario } from "../helpers/releases-scenario.ts";
test("real workerd D1: released-volume snapshots persist, use edition ownership, and invalidate changed metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "strawby-releases-"));
  const db = await openLocalD1(root);
  try {
    const statements = await migrationStatements();
    for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
    await releasesScenario(db);
  } finally { await db.close(); await rm(root, {recursive: true, force: true}); }
});
