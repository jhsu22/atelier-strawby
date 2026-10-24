import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { normalizeCsv } from "../../scripts/lib/normalize.ts";
import { persistPlan } from "../../scripts/lib/import.ts";
import { seedSampleCds } from "../../scripts/lib/sample-cds.ts";
import { crudScenario, transferScenario } from "../helpers/stage3-scenarios.ts";
import {
  exportBackup,
  restoreBackup,
} from "../../src/server/services/backup.ts";
import { createImportPreview } from "../../src/server/services/transfer.ts";
import { revision } from "../../src/server/db/store.ts";

test("persistent CRUD retains duplicate copies, dates, manual tags, CD editions/tracks and rejects stale edits", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await crudScenario(db);
  } finally {
    await db.close();
  }
});
test("CSV preview, staged resume, duplicates, Discogs mapping, cancellation and lossless JSON restore", async () => {
  const db = openSqlite(":memory:"),
    restored = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await migrateSqlite(restored);
    await transferScenario(db, restored);
  } finally {
    await db.close();
    await restored.close();
  }
});
test("original 177-copy format previews safely and full seeded JSON restores identities and import provenance", async () => {
  const db = openSqlite(":memory:"),
    restored = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await migrateSqlite(restored);
    const csv = readFileSync("initial_collection.csv", "utf8");
    await persistPlan(db, normalizeCsv(csv));
    await seedSampleCds(db);
    const preview = await createImportPreview(db, {
      kind: "manga",
      filename: "initial_collection.csv",
      text: csv,
    });
    assert.equal(preview.total, 177);
    assert.equal(preview.errors, 0);
    const backup = await exportBackup(db);
    assert.ok(JSON.stringify(backup).length < 900000);
    await restoreBackup(restored, backup, await revision(restored));
    assert.deepEqual((await exportBackup(restored)).tables, backup.tables);
  } finally {
    await db.close();
    await restored.close();
  }
});
