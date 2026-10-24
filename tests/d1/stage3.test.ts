import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalD1, openLocalPlatform } from "../../scripts/lib/d1.ts";
import { crudScenario, transferScenario } from "../helpers/stage3-scenarios.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";
import { coverScenario } from "../helpers/cover-scenario.ts";
import { mediumScenario } from "../helpers/medium-scenario.ts";
import { migrationStatements } from "../../scripts/lib/migrations.ts";
import type { Store } from "../../src/server/db/store.ts";

async function migrate(db: Store) {
  const statements = await migrationStatements();
  for (let i = 0; i < statements.length; i += 40)
    await db.batch(statements.slice(i, i + 40));
}

test("real D1: Stage 3 CRUD, staged imports and JSON restoration use the same persistent SQL behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "strawby-stage3-"));
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

test("real D1/R2: cover utility checkpoints matches and cached artwork across a runtime restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "strawby-covers-"));
  let platform = await openLocalPlatform(root);
  try {
    assert.ok(platform.bucket, "COVERS R2 binding is configured");
    await migrate(platform.db);
    await coverScenario(platform.db, platform.bucket);
    await platform.db.close();
    platform = await openLocalPlatform(root);
    const keys = await platform.db.all(
      "SELECT DISTINCT object_key FROM cover_variants WHERE object_key IS NOT NULL",
    );
    assert.equal(keys.length, 3);
    for (const row of keys)
      assert.ok(await platform.bucket!.head(String(row.object_key)));
  } finally {
    await platform.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("real D1: the medium migration applies, and light novels, books, CSV and legacy restores behave as on SQLite", async () => {
  const root = await mkdtemp(join(tmpdir(), "strawby-medium-"));
  const db = await openLocalD1(join(root, "source"));
  const restored = await openLocalD1(join(root, "restored"));
  try {
    await migrate(db);
    await migrate(restored);
    await mediumScenario(db, restored);
  } finally {
    await db.close();
    await restored.close();
    await rm(root, { recursive: true, force: true });
  }
});
