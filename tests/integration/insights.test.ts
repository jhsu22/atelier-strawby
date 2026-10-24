import test from "node:test";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { insightsScenario } from "../helpers/insights-scenario.ts";
test("Stage 4 SQL totals and every timeline date reconcile with the original CSV; later CD writes update metrics", async () => {
  const db = openSqlite(":memory:");
  try { await migrateSqlite(db); await insightsScenario(db); } finally { await db.close(); }
});
