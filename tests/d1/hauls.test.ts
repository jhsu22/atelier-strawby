import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalD1 } from "../../scripts/lib/d1.ts";
import { migrationStatements } from "../../scripts/lib/migrations.ts";
import { saveHaul } from "../../src/server/services/hauls.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { HAUL_MAX_COPIES, volumeRange } from "../../src/domain/haul.ts";
import type { Store } from "../../src/server/db/store.ts";
import type { CdCopy, LibraryData, MangaCopy } from "../../src/domain/library.ts";

async function migrate(db: Store) {
  const statements = await migrationStatements();
  for (let i = 0; i < statements.length; i += 40)
    await db.batch(statements.slice(i, i + 40));
}
const copies = (data: LibraryData) => data.entries.flatMap((entry): (MangaCopy | CdCopy)[] => entry.copies);
const item = (volume: string) => ({ kind: "manga", title: "D1 haul series", authors: ["D1 author"], publisher: "D1 press", volume });

test("real D1: a full haul saves atomically, a failing one leaves nothing, and private notes and stores stay off the public read", async () => {
  const root = await mkdtemp(join(tmpdir(), "strawby-hauls-"));
  let db = await openLocalD1(root);
  try {
    await migrate(db);
    const id = crypto.randomUUID();
    const saved = await saveHaul(db, { haul: { id, acquiredOn: "2026-10-22", store: "D1 store", notes: "from sammy <3", items: volumeRange(1, HAUL_MAX_COPIES).map(item) }, requestId: crypto.randomUUID() });
    assert.equal(saved.ids.length, HAUL_MAX_COPIES);

    // D1 batches are atomic: a foreign-key failure on the copy undoes the haul row too.
    await assert.rejects(db.batch([
      { sql: "INSERT INTO acquisition_batches(id) VALUES ('rolled-back')", params: [] },
      { sql: "INSERT INTO collection_items(id, media_kind, acquisition_batch_id) VALUES ('orphan', 'manga', 'missing')", params: [] },
    ]));
    assert.deepEqual((await db.all("SELECT COUNT(*) AS n FROM acquisition_batches")).map((row) => ({ ...row })), [{ n: 1 }]);

    await db.close();
    db = await openLocalD1(root);
    const shelf = copies(await libraryData((sql) => db.all(sql)));
    const owner = copies(await libraryData((sql) => db.all(sql), { owner: true }));
    assert.equal(shelf.length, HAUL_MAX_COPIES);
    assert.ok(shelf.every((copy) => copy.notes === null && copy.haul?.store === null && !copy.tags?.includes("Gifts from Sammy")));
    assert.ok(owner.every((copy) => copy.notes === "from sammy <3" && copy.haul?.store === "D1 store" && copy.tags?.includes("Gifts from Sammy")));
  } finally {
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});
