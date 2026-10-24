import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { commitImport, createImportPreview, exportCsv } from "../../src/server/services/transfer.ts";
import { exportBackup, restoreBackup } from "../../src/server/services/backup.ts";
import { revision } from "../../src/server/db/store.ts";
import { itemSchema } from "../../src/domain/item.ts";
import { bookShelf, defaultBrowseState, browseEntries } from "../../src/domain/library.ts";

test("book titles and series numbers persist independently and sort numerically across CSV and backups", async () => {
  const db = openSqlite(":memory:");
  const imported = openSqlite(":memory:");
  const restored = openSqlite(":memory:");
  const legacy = openSqlite(":memory:");
  const title = "The Extremely Long but Entirely Valid Title of the First Book";
  const series = { kind: "manga", medium: "book", title: "A Book Series", authors: ["Writer"] };
  try {
    for (const target of [db, imported, restored, legacy]) await migrateSqlite(target);
    await saveItem(db, { ...series, volume: "10", bookTitle: "The Tenth Book" });
    const first = await saveItem(db, { ...series, volume: "2", bookTitle: title });
    let current = await getItem(db, first.id);
    assert.equal(current.item.volume, "2");
    assert.equal(current.item.bookTitle, title);
    const corrected = title + ": Revised";
    await saveItem(db, { ...current.item, bookTitle: corrected }, { id: first.id, version: current.version });
    current = await getItem(db, first.id);
    assert.equal(current.item.volume, "2");
    assert.equal(current.item.bookTitle, corrected);
    const library = await libraryData((sql) => db.all(sql));
    const shelf = bookShelf(library.entries, defaultBrowseState);
    assert.deepEqual(shelf.map(({ copy }) => [copy.volume, copy.bookTitle]), [["2", corrected], ["10", "The Tenth Book"]]);
    assert.equal(browseEntries(library.entries, { ...defaultBrowseState, query: "Revised" }).length, 1);
    const csv = await exportCsv(db, "manga");
    assert.ok(csv.includes('"Book Title"'));
    const preview = await createImportPreview(imported, { kind: "manga", filename: "books.csv", text: csv });
    assert.equal(preview.errors, 0);
    while (!(await commitImport(imported, preview.token, false)).complete);
    assert.deepEqual(bookShelf((await libraryData(sql => imported.all(sql))).entries, defaultBrowseState).map(({ copy }) => [copy.volume, copy.bookTitle]), [["2", corrected], ["10", "The Tenth Book"]]);
    await restoreBackup(restored, await exportBackup(db), await revision(restored));
    assert.equal((await getItem(restored, first.id)).item.bookTitle, corrected);
    const oldBackup = await exportBackup(db);
    for (const row of oldBackup.tables.volume_editions!) {
      if (row.volume_label === "2") {
        row.volume_label = corrected;
        row.volume_sort = null;
        row.numbering_key = corrected.toLowerCase();
      }
      delete row.book_title;
    }
    await restoreBackup(legacy, oldBackup, await revision(legacy));
    const legacyItem = (await getItem(legacy, first.id)).item;
    assert.equal(legacyItem.bookTitle, corrected);
    assert.equal(legacyItem.volume, "");
    assert.equal(itemSchema.safeParse({ ...series, volume: "The Second Book" }).success, false);
    assert.equal(itemSchema.parse({ ...series, volume: "", bookTitle: title }).volume, "");
    for (const medium of ["manga", "light_novel"]) {
      assert.equal(itemSchema.parse({ ...series, medium, volume: "2" }).volume, "2");
    }
  } finally {
    for (const target of [db, imported, restored, legacy]) await target.close();
  }
});

test("migration preserves existing book title labels and leaves numbered manga and books intact", async () => {
  const db = openSqlite(":memory:");
  try {
    for (const name of ["0000_foundation", "0001_edition_medium", "0002_request_limits"])
      db.raw.exec(readFileSync(`drizzle/${name}.sql`, "utf8"));
    db.raw.exec(`INSERT INTO series(id,canonical_title,sort_title) VALUES ('s','Series','series');
      INSERT INTO edition_runs(id,series_id,edition_title,language,language_basis,format,numbering_basis,medium) VALUES
      ('books','s','Books','EN','confirmed','standard','printed','book'),
      ('manga','s','Manga','EN','confirmed','standard','printed','manga');
      INSERT INTO volume_editions(id,edition_run_id,volume_label,volume_sort,numbering_key) VALUES
      ('title','books','The First Book',NULL,'the first book'),
      ('number','books','2',2000,'2'), ('manga','manga','Special',NULL,'special');`);
    db.raw.exec(readFileSync("drizzle/0003_book_titles.sql", "utf8"));
    const rows = await db.all("SELECT id,volume_label,book_title,volume_sort FROM volume_editions ORDER BY id");
    assert.deepEqual(rows.map(row => [row.id, row.volume_label, row.book_title, row.volume_sort]), [
      ["manga", "Special", "", null], ["number", "2", "", 2000], ["title", "", "The First Book", null],
    ]);
  } finally { await db.close(); }
});
