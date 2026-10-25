import assert from "node:assert/strict";
import test from "node:test";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { saveItem } from "../../src/server/services/items.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { exportBackup, restoreBackup } from "../../src/server/services/backup.ts";
import { revision } from "../../src/server/db/store.ts";

test("backups made while sample CDs existed restore without them", async () => {
  const db = openSqlite(":memory:");
  const restored = openSqlite(":memory:");
  try {
    for (const target of [db, restored]) await migrateSqlite(target);
    const owned = await saveItem(db, { kind: "cd", title: "Owned CD", notes: "a gift" });
    const sample = await saveItem(db, { kind: "cd", title: "Old sample", tags: ["Gifts"] });
    await db.batch([{ sql: "UPDATE collection_items SET is_sample=1 WHERE id=?", params: [sample.id] }]);
    const backup = await exportBackup(db);
    assert.ok(backup.tables.item_tags!.some((row) => row.item_id === sample.id));
    await restoreBackup(restored, backup, await revision(restored));
    const copies = (await libraryData((sql) => restored.all(sql), { owner: true })).entries.flatMap((entry) => entry.copies);
    assert.deepEqual(copies.map((copy) => copy.id), [owned.id]);
    assert.deepEqual(await restored.all("SELECT id FROM collection_items WHERE is_sample=1"), []);
  } finally {
    for (const target of [db, restored]) await target.close();
  }
});
