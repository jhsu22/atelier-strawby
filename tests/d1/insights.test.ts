import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalD1 } from "../../scripts/lib/d1.ts";
import { migrationStatements } from "../../scripts/lib/migrations.ts";
import { insightsScenario } from "../helpers/insights-scenario.ts";
test("real workerd D1: Stage 4 analytics reconcile with SQL and source CSV, and respond to personal CD writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "strawby-insights-"));
  const db = await openLocalD1(root);
  try {
    const statements = await migrationStatements();
    for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
    await insightsScenario(db);
  } finally { await db.close(); await rm(root, {recursive: true, force: true}); }
});
