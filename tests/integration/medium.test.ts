import test from "node:test";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { mediumScenario } from "../helpers/medium-scenario.ts";

test("light novels reclassify whole editions, books form their own category, and CSV/backups carry the medium", async () => {
  const db = openSqlite(":memory:");
  const restored = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await migrateSqlite(restored);
    await mediumScenario(db, restored);
  } finally {
    await db.close();
    await restored.close();
  }
});
