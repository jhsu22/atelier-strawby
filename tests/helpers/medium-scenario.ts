import assert from "node:assert/strict";
import type { Store } from "../../src/server/db/store.ts";
import { revision, statement as s } from "../../src/server/db/store.ts";
import {
  artworkStatements,
  getItem,
  saveItem,
} from "../../src/server/services/items.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { collectionSummary } from "../../src/server/services/collection-summary.ts";
import {
  commitImport,
  createImportPreview,
  exportCsv,
} from "../../src/server/services/transfer.ts";
import {
  exportBackup,
  restoreBackup,
} from "../../src/server/services/backup.ts";
import {
  bookShelf,
  browseEntries,
  defaultBrowseState,
} from "../../src/domain/library.ts";
import type { BookSeries, MangaSeries } from "../../src/domain/library.ts";

const read = (db: Store) => libraryData((sql) => db.all(sql));

// Shared by SQLite integration and real workerd D1 tests.
export async function mediumScenario(db: Store, restored: Store) {
  const story = {
    kind: "manga",
    title: "Novel Story",
    authors: ["Writer"],
    publisher: "Yen Press",
  };
  const first = await saveItem(db, { ...story, volume: "1" });
  const second = await saveItem(db, {
    ...story,
    volume: "2",
    artwork: {
      url: "https://example.com/owner-cover.jpg",
      scope: "edition",
      attribution: "Owner-selected artwork",
    },
  });
  // An unattended (not owner-selected) cover on volume 1, as the cover
  // utility would apply it while the series was still classified as manga.
  const automatic = await artworkStatements(
    {
      url: "https://uploads.mangadex.org/covers/x/manga-cover.jpg.512.jpg",
      provider: "mangadex",
      sourceId: "x",
      scope: "edition",
      attribution: "mangadex · automatic volume/language match",
      language: "EN",
    },
    false,
  );
  await db.batch([
    ...automatic.statements,
    s(
      "UPDATE volume_editions SET cover_asset_id=? WHERE id=(SELECT volume_edition_id FROM volumes WHERE item_id=?)",
      automatic.id,
      first.id,
    ),
  ]);
  const before = await getItem(db, second.id);

  // Reclassifying one copy reclassifies its whole edition in place.
  const current = await getItem(db, first.id);
  assert.equal(current.item.medium, "manga");
  await saveItem(
    db,
    { ...current.item, medium: "light_novel" },
    { id: first.id, version: current.version },
  );
  let library = await read(db);
  const series = library.entries.find(
    (entry): entry is MangaSeries =>
      entry.kind === "manga" && entry.title === "Novel Story",
  )!;
  assert.deepEqual(
    series.copies.map((copy) => [copy.volume, copy.medium]),
    [
      ["1", "light_novel"],
      ["2", "light_novel"],
    ],
  );
  assert.equal(new Set(series.copies.map((c) => c.editionRunId)).size, 1);
  // The manga-matched automatic cover is cleared; the owner's choice stays.
  assert.equal((await getItem(db, first.id)).item.artwork, null);
  const kept = await getItem(db, second.id);
  assert.equal(kept.item.artwork?.url, "https://example.com/owner-cover.jpg");
  assert.equal(kept.version, before.version + 1);
  await assert.rejects(
    saveItem(db, before.item, { id: second.id, version: before.version }),
    /changed in another session/,
  );

  // Books are their own category, also beside a manga series of that title.
  const book = await saveItem(db, {
    kind: "manga",
    medium: "book",
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    publisher: "Ballantine Books",
  });
  const sameTitle = await saveItem(db, {
    ...story,
    medium: "book",
    editionTitle: "Novel Story: The Companion Novel",
  });
  assert.equal((await getItem(db, book.id)).item.medium, "book");
  library = await read(db);
  const books = library.entries.filter(
    (entry): entry is BookSeries => entry.kind === "book",
  );
  assert.deepEqual(books.map((entry) => entry.title).sort(), [
    "Novel Story",
    "Project Hail Mary",
  ]);
  assert.equal(
    books.find((entry) => entry.title === "Novel Story")!.id,
    `${series.id}~book`,
  );
  assert.ok(
    books
      .find((entry) => entry.title === "Novel Story")!
      .copies.some((copy) => copy.id === sameTitle.id),
  );

  // Browsing: Books tab, light-novel type filter, author-ordered book shelf.
  const titles = (state: Partial<typeof defaultBrowseState>) =>
    browseEntries(library.entries, { ...defaultBrowseState, ...state }).map(
      (entry) => `${entry.kind}:${entry.title}`,
    );
  assert.deepEqual(titles({ media: "book" }), [
    "book:Novel Story",
    "book:Project Hail Mary",
  ]);
  assert.deepEqual(titles({ type: "light_novel" }), ["manga:Novel Story"]);
  assert.deepEqual(titles({ media: "manga", type: "manga" }), []);
  assert.deepEqual(
    bookShelf(library.entries, defaultBrowseState).map(
      ({ entry }) => entry.authors[0],
    ),
    ["Andy Weir", "Writer"],
  );

  // The manga record counts light novels but not books.
  const summary = await collectionSummary((sql) => db.all(sql));
  assert.equal(summary.physicalCopies, 2);

  // The volume CSV carries the medium both ways; invalid values are rejected.
  const csv = await exportCsv(db, "manga");
  const header = csv.split("\n")[0]!.split(",");
  const mediumColumn = header.indexOf('"Medium"');
  assert.ok(mediumColumn > 0);
  assert.deepEqual(
    csv
      .split("\n")
      .slice(1)
      .filter(Boolean)
      .map((line) => line.split(",")[mediumColumn])
      .sort(),
    ['"Book"', '"Book"', '"Light novel"', '"Light novel"'],
  );
  // The same row is a duplicate of the light novel, but not of a book.
  for (const [medium, duplicates] of [
    ["Light novel", 1],
    ["Book", 0],
  ] as const)
    assert.equal(
      (
        await createImportPreview(db, {
          kind: "manga",
          filename: "again.csv",
          text: `Title,Volume,Author,Publisher,Date Acquired,Notes,Medium\nNovel Story,1,Writer,Yen Press,,,${medium}`,
        })
      ).duplicates,
      duplicates,
      medium,
    );
  const invalid = await createImportPreview(db, {
    kind: "manga",
    filename: "invalid.csv",
    text: "Title,Volume,Author,Publisher,Date Acquired,Notes,Medium\nBad Medium,1,Someone,House,,,Comic",
  });
  assert.equal(invalid.errors, 1);
  const preview = await createImportPreview(db, {
    kind: "manga",
    filename: "books.csv",
    text: "Title,Volume,Author,Publisher,Date Acquired,Notes,Medium\nImported Book,1,Some Author,Some House,2026-10-23,,Book",
  });
  assert.equal(preview.errors, 0);
  while (!(await commitImport(db, preview.token, false)).complete);
  library = await read(db);
  assert.ok(
    library.entries.some(
      (entry) => entry.kind === "book" && entry.title === "Imported Book",
    ),
  );

  // Version 1 backups from before the medium column still restore exactly.
  const backup = await exportBackup(db);
  for (const row of backup.tables.edition_runs!)
    if (row.medium === "manga") delete row.medium;
  await restoreBackup(restored, backup, await revision(restored));
  assert.deepEqual(
    (await read(restored)).entries.map((entry) => [
      entry.kind,
      entry.title,
      entry.kind === "cd" ? [] : entry.copies.map((copy) => copy.medium),
    ]),
    (await read(db)).entries.map((entry) => [
      entry.kind,
      entry.title,
      entry.kind === "cd" ? [] : entry.copies.map((copy) => copy.medium),
    ]),
  );
}
