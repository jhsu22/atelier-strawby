import test from "node:test";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { largeCollectionScenario } from "../helpers/large-collection-scenario.ts";

test("2,124-copy backup chunks restore losslessly, reject missing chunks, and support multilingual search", async () => {
  const source = openSqlite(":memory:"), restored = openSqlite(":memory:");
  try { await migrateSqlite(source); await migrateSqlite(restored); await largeCollectionScenario(source, restored); }
  finally { await source.close(); await restored.close(); }
});
