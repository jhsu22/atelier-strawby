import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalD1 } from "../../scripts/lib/d1.ts";
import { crudScenario, transferScenario } from "../helpers/stage3-scenarios.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";

test("real D1: Stage 3 CRUD, staged imports and JSON restoration use the same persistent SQL behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "strawby-stage3-"));
  const migrate = async (db: Awaited<ReturnType<typeof openLocalD1>>) => {
    const sql = await readFile("drizzle/0000_foundation.sql", "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.replace(/^--.*$/gm, "").trim())
      .filter(Boolean)
      .map((sql) => ({ sql, params: [] }));
    for (let i = 0; i < statements.length; i += 40)
      await db.batch(statements.slice(i, i + 40));
  };
  let db = await openLocalD1(join(root, "source"));
  const restored = await openLocalD1(join(root, "restored"));
  try {
    await migrate(db);
    await migrate(restored);
    await crudScenario(db);
    await transferScenario(db, restored);
    const copy = await saveItem(db, {
      kind: "manga",
      title: "Survives process restart",
      volume: "2",
    });
    await db.close();
    db = await openLocalD1(join(root, "source"));
    assert.equal(
      (await getItem(db, copy.id)).item.title,
      "Survives process restart",
    );
  } finally {
    await db.close();
    await restored.close();
    await rm(root, { recursive: true, force: true });
  }
});
