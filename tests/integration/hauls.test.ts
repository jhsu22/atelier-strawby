import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { normalizeCsv } from "../../scripts/lib/normalize.ts";
import { persistPlan } from "../../scripts/lib/import.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { saveHaul } from "../../src/server/services/hauls.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";
import { exportBackup, restoreBackup } from "../../src/server/services/backup.ts";
import { revision } from "../../src/server/db/store.ts";
import type { Store } from "../../src/server/db/store.ts";
import { acquisitions, collectionAnalytics, haulTimeline } from "../../src/domain/collection-insights.ts";
import { HAUL_MAX_COPIES, volumeRange } from "../../src/domain/haul.ts";
import { librarySchema } from "../../src/domain/library-schema.ts";
import { browseEntries, defaultBrowseState } from "../../src/domain/library.ts";
import type { MangaCopy } from "../../src/domain/library.ts";

const plan = normalizeCsv(readFileSync("initial_collection.csv", "utf8"));
const newSeries = (volume: string) => ({ kind: "manga", title: "Haul test series", authors: ["Haul author"], publisher: "Haul press", language: "JP", languageBasis: "specified", volume });
const haul = (patch: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  acquiredOn: "2026-10-20",
  store: "Haulmark Books",
  notes: "convention weekend",
  private: true,
  items: volumeRange(1, 3).map(newSeries),
  ...patch,
});
const plain = async (rows: Promise<Record<string, unknown>[]>) => (await rows).map((row) => ({ ...row }));
const copies = async (db: Store, owner: boolean) =>
  (await libraryData((sql) => db.all(sql), { owner })).entries.flatMap((entry) => entry.kind === "cd" ? [] : entry.copies) as MangaCopy[];

test("a haul saves every copy atomically with the shared date, store and note, and groups as one timeline card", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await persistPlan(db, plan);
    const owned = (await libraryData((sql) => db.all(sql), { owner: true })).entries.find((entry) => entry.title === "Chainsaw Man")!;
    if (owned.kind === "cd") throw new Error("Expected a series");
    const run = owned.copies.find((copy) => copy.language === "EN")!;
    const continuing = { kind: "manga", seriesId: owned.id, title: owned.title, authors: owned.authors, editionTitle: run.editionTitle, language: run.language, languageBasis: run.languageBasis, publisher: run.publisher, format: run.format, numberingBasis: run.numberingBasis, medium: run.medium, volume: "12" };
    const input = haul({ items: [continuing, ...volumeRange(1, 3).map(newSeries)] });
    const requestId = crypto.randomUUID();
    const saved = await saveHaul(db, { haul: input, requestId });
    assert.equal(saved.ids.length, 4);
    assert.deepEqual(await saveHaul(db, { haul: input, requestId }), { ...saved, repeated: true }, "a retried request saves nothing twice");

    const rows = await db.all("SELECT acquired_on, notes, notes_private, acquisition_batch_id FROM collection_items WHERE acquisition_batch_id=?", [input.id]);
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.acquired_on === "2026-10-20" && row.notes === "convention weekend" && row.notes_private === 1));
    assert.deepEqual(await plain(db.all("SELECT store, store_private FROM acquisition_batches")), [{ store: "Haulmark Books", store_private: 1 }]);
    const ownedCopy = (await copies(db, true)).find((copy) => copy.id === saved.ids[0])!;
    assert.equal(ownedCopy.editionRunId, run.editionRunId, "a continuing volume joins the owned edition run");

    const owner = librarySchema.parse(await libraryData((sql) => db.all(sql), { owner: true }));
    const shelf = librarySchema.parse(await libraryData((sql) => db.all(sql)));
    const card = haulTimeline(acquisitions(owner.entries)).find((entry) => entry.logged?.id === input.id)!;
    assert.equal(card.items.length, 4);
    assert.deepEqual(card.logged, { id: input.id, acquiredOn: "2026-10-20", store: "Haulmark Books", storePrivate: true });
    const publicCard = haulTimeline(acquisitions(shelf.entries)).find((entry) => entry.logged?.id === input.id)!;
    assert.deepEqual(publicCard.logged, { id: input.id, acquiredOn: "2026-10-20", store: null }, "a private haul hides its store publicly");
    assert.ok(publicCard.items.every((item) => item.copy.notes === null));
    const byStore = { ...defaultBrowseState, query: "Haulmark" };
    assert.equal(browseEntries(shelf.entries, byStore).length, 0, "a private store isn't searchable publicly");
    assert.equal(browseEntries(owner.entries, byStore).length, 2);
    assert.equal(collectionAnalytics(owner.entries).mangaCopies, 181);
  } finally {
    await db.close();
  }
});

test("a failing copy saves nothing; later parts join the same haul; a public haul shows its store", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const input = haul({ private: false });
    await assert.rejects(
      saveHaul(db, { haul: { ...input, items: [...input.items, { ...newSeries("4"), seriesId: "missing-series" }] }, requestId: crypto.randomUUID() }),
      /no longer exists/,
    );
    assert.deepEqual(await plain(db.all("SELECT COUNT(*) n FROM collection_items")), [{ n: 0 }]);
    assert.deepEqual(await plain(db.all("SELECT COUNT(*) n FROM acquisition_batches")), [{ n: 0 }]);

    const before = await revision(db);
    await saveHaul(db, { haul: input, requestId: crypto.randomUUID() });
    assert.ok((await revision(db)) > before, "a haul save advances the collection revision");
    await saveHaul(db, { haul: { ...input, items: volumeRange(4, 5).map(newSeries) }, requestId: crypto.randomUUID() });
    const shelf = await copies(db, false);
    assert.equal(shelf.length, 5);
    assert.ok(shelf.every((copy) => copy.haul?.id === input.id && copy.haul.store === "Haulmark Books" && copy.notes === "convention weekend"));
    assert.equal(new Set(shelf.map((copy) => copy.editionRunId)).size, 1, "one new series and edition across both parts");
    const publicEntries = (await libraryData((sql) => db.all(sql))).entries;
    assert.equal(haulTimeline(acquisitions(publicEntries)).length, 1);
    assert.equal(browseEntries(publicEntries, { ...defaultBrowseState, query: "Haulmark" }).length, 1, "a public store is searchable");
  } finally {
    await db.close();
  }
});

test("a full haul stays inside the D1 query budget, and more copies than one save allows are refused", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    let reads = 0, writes = 0;
    const counting: Store = {
      all: (sql, params) => { reads++; return db.all(sql, params); },
      batch: (statements) => { writes += statements.length; return db.batch(statements); },
    };
    await saveHaul(counting, { haul: haul({ items: volumeRange(1, HAUL_MAX_COPIES).map(newSeries) }), requestId: crypto.randomUUID() });
    assert.ok(reads + writes < 1000, `${reads} reads + ${writes} writes must stay under D1's 1,000 queries per request`);
    // A standalone book needs only its title, as in the editor (book titles, 0003_book_titles).
    const book = await saveHaul(db, { haul: haul({ items: [{ kind: "manga", title: "Haul essays", medium: "book", volume: "", bookTitle: "Collected essays" }] }), requestId: crypto.randomUUID() });
    assert.equal((await getItem(db, book.ids[0]!)).item.bookTitle, "Collected essays");
    await assert.rejects(
      saveHaul(db, { haul: haul({ items: Array.from({ length: HAUL_MAX_COPIES + 1 }, (_, index) => newSeries(String(index + 1))) }), requestId: crypto.randomUUID() }),
      /at most 20/,
    );
    assert.deepEqual(volumeRange(4, 8), ["4", "5", "6", "7", "8"]);
    assert.deepEqual(volumeRange(8, 4), []);
    assert.deepEqual(volumeRange(0, 2), []);
    assert.equal(volumeRange(1, 30).length, 30, "a long range is never silently cut short");
  } finally {
    await db.close();
  }
});

test("editing keeps a copy in its haul until the owner takes it out; unknown hauls are refused; backups round-trip hauls", async () => {
  const db = openSqlite(":memory:"),
    restored = openSqlite(":memory:"),
    legacy = openSqlite(":memory:");
  try {
    for (const store of [db, restored, legacy]) await migrateSqlite(store);
    const input = haul();
    const { ids } = await saveHaul(db, { haul: input, requestId: crypto.randomUUID() });
    const { item, version } = await getItem(db, ids[0]!);
    assert.equal(item.acquisitionBatchId, input.id);
    await saveItem(db, { ...item, notes: "edited" }, { id: ids[0], version });
    const kept = await getItem(db, ids[0]!);
    assert.equal(kept.item.acquisitionBatchId, input.id);
    await saveItem(db, { ...kept.item, acquisitionBatchId: null }, { id: ids[0], version: kept.version });
    assert.equal((await getItem(db, ids[0]!)).item.acquisitionBatchId, null);
    await assert.rejects(saveItem(db, { ...newSeries("9"), acquisitionBatchId: "no-such-haul" }), /haul no longer exists/);

    const backup = await exportBackup(db);
    assert.equal(backup.tables.acquisition_batches!.length, 1);
    await restoreBackup(restored, backup, await revision(restored));
    assert.deepEqual(await plain(restored.all("SELECT id, store FROM acquisition_batches")), [{ id: input.id, store: "Haulmark Books" }]);
    assert.equal((await restored.all("SELECT COUNT(*) n FROM collection_items WHERE acquisition_batch_id IS NOT NULL"))[0]!.n, 2);

    // A backup made before hauls existed has neither the table nor the column.
    const { acquisition_batches: _, ...tables } = backup.tables;
    const before = { ...backup, tables: { ...tables, collection_items: tables.collection_items!.map(({ acquisition_batch_id: _id, ...row }) => row) } };
    await restoreBackup(legacy, before, await revision(legacy));
    assert.deepEqual(await plain(legacy.all("SELECT COUNT(*) n FROM collection_items WHERE acquisition_batch_id IS NULL")), [{ n: 3 }]);
  } finally {
    await db.close();
    await restored.close();
    await legacy.close();
  }
});
