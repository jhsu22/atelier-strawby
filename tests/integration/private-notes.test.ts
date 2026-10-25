import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { normalizeCsv } from "../../scripts/lib/normalize.ts";
import { persistPlan } from "../../scripts/lib/import.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { librarySchema } from "../../src/domain/library-schema.ts";
import { browseEntries, defaultBrowseState } from "../../src/domain/library.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";
import { exportBackup, restoreBackup } from "../../src/server/services/backup.ts";
import { revision } from "../../src/server/db/store.ts";
import type { CdCopy, LibraryData, MangaCopy } from "../../src/domain/library.ts";

const plan = normalizeCsv(readFileSync("initial_collection.csv", "utf8"));
const copies = (data: LibraryData) =>
  data.entries.flatMap((entry): (MangaCopy | CdCopy)[] => entry.copies);
const MEMORY = ["Gifts from Sammy", "Kinokuniya Trips", "Box Sets", "Korea Trip", "Proxy Hauls", "Gifts"];

test("existing notes migrate as private: the public view omits them and their derived memory tags, the owner view keeps both", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await persistPlan(db, plan);
    const owner = librarySchema.parse(await libraryData((sql) => db.all(sql), { owner: true }));
    const shelf = librarySchema.parse(await libraryData((sql) => db.all(sql)));
    const noted = copies(owner).filter((copy) => copy.notes);
    const [{ n }] = await db.all("SELECT COUNT(notes) n FROM collection_items WHERE is_sample=0") as [{ n: number }];
    assert.ok(n > 0);
    assert.equal(noted.length, n);
    assert.ok(copies(owner).every((copy) => copy.notesPrivate === true));
    assert.ok(copies(owner).some((copy) => copy.tags?.includes("Gifts from Sammy")));

    assert.ok(copies(shelf).every((copy) => copy.notes === null && !("notesPrivate" in copy)));
    assert.ok(!copies(shelf).some((copy) => copy.tags?.some((tag) => MEMORY.includes(tag))));
    // Edition tags describe the physical copy, not the memory, and stay public.
    assert.ok(copies(shelf).some((copy) => copy.tags?.includes("Box Set")));
    assert.equal(copies(shelf).length, copies(owner).length);
    // Private text is not searchable from the public shelf.
    const query = { ...defaultBrowseState, query: "vromans" };
    assert.equal(browseEntries(shelf.entries, query).length, 0);
    assert.ok(browseEntries(owner.entries, query).length > 0);
  } finally {
    await db.close();
  }
});

test("new copies default to private; a note made public appears with its derived tags, manual tags stay public either way", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const saved = await saveItem(db, {
      kind: "manga",
      title: "Private note story",
      volume: "1",
      notes: "from sammy <3",
      tags: ["Signed"],
    });
    const find = async (owner: boolean) =>
      copies(await libraryData((sql) => db.all(sql), { owner })).find((copy) => copy.id === saved.id)!;
    const { item, version } = await getItem(db, saved.id);
    assert.equal(item.notesPrivate, true);
    assert.deepEqual([(await find(false)).notes, (await find(false)).tags], [null, ["Signed"]]);
    assert.deepEqual((await find(true)).tags, ["Gifts from Sammy", "Signed"]);

    await saveItem(db, { ...item, notesPrivate: false }, { id: saved.id, version });
    const shown = await find(false);
    assert.equal(shown.notes, "from sammy <3");
    assert.deepEqual(shown.tags, ["Gifts from Sammy", "Signed"]);
    assert.equal((await find(true)).notesPrivate, false);
    assert.equal((await getItem(db, saved.id)).item.notesPrivate, false);
  } finally {
    await db.close();
  }
});

test("JSON backups round-trip note privacy, and backups made before private notes restore as private", async () => {
  const db = openSqlite(":memory:"),
    current = openSqlite(":memory:"),
    legacy = openSqlite(":memory:");
  try {
    for (const store of [db, current, legacy]) await migrateSqlite(store);
    const shown = await saveItem(db, { kind: "cd", title: "Public note CD", notes: "shown", notesPrivate: false });
    const hidden = await saveItem(db, { kind: "cd", title: "Private note CD", notes: "hidden" });
    const backup = await exportBackup(db);
    const privacy = async (store: typeof db) =>
      Object.fromEntries(
        (await store.all("SELECT id, notes_private FROM collection_items ORDER BY id")).map((row) => [row.id, row.notes_private]),
      );
    await restoreBackup(current, backup, await revision(current));
    assert.deepEqual(await privacy(current), { [shown.id]: 0, [hidden.id]: 1 });

    const before = {
      ...backup,
      tables: {
        ...backup.tables,
        collection_items: backup.tables.collection_items!.map(({ notes_private: _, ...row }) => row),
      },
    };
    await restoreBackup(legacy, before, await revision(legacy));
    assert.deepEqual(await privacy(legacy), { [shown.id]: 1, [hidden.id]: 1 });
  } finally {
    await db.close();
    await current.close();
    await legacy.close();
  }
});
