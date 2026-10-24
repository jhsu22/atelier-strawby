import assert from "node:assert/strict";
import type { Store } from "../../src/server/db/store.ts";
import { revision } from "../../src/server/db/store.ts";
import { itemSchema } from "../../src/domain/item.ts";
import {
  getItem,
  saveItem,
  deleteItem,
} from "../../src/server/services/items.ts";
import { libraryData } from "../../src/server/services/library.ts";
import {
  createImportPreview,
  commitImport,
  cancelImport,
  exportCsv,
  pendingImport,
} from "../../src/server/services/transfer.ts";
import {
  exportBackup,
  restoreBackup,
} from "../../src/server/services/backup.ts";

export async function crudScenario(db: Store) {
  const manga = itemSchema.parse({
    kind: "manga",
    title: "Persistent story",
    authors: ["Author"],
    volume: "1",
    language: "JP",
    publisher: "Publisher",
    acquiredOn: "2024-02-29",
    notes: "gift from sammy, kinokuniya box set",
    artwork: { url: "https://example.com/cover.jpg", scope: "edition" },
  });
  const requestId = crypto.randomUUID();
  const first = await saveItem(db, manga, { requestId });
  assert.equal((await saveItem(db, manga, { requestId })).id, first.id);
  await assert.rejects(
    saveItem(db, { ...manga, notes: "Changed retry" }, { requestId }),
    /already saved/,
  );
  const duplicate = await saveItem(db, manga, {
    requestId: crypto.randomUUID(),
  });
  assert.notEqual(first.id, duplicate.id);
  let read = await getItem(db, first.id);
  assert.equal(read.item.language, "JP");
  assert.equal(read.item.acquiredOn, "2024-02-29");
  assert.equal(read.item.tagsMode, "auto");
  assert.ok(
    (
      await db.all(
        "SELECT t.label FROM item_tags it JOIN tags t ON t.id=it.tag_id WHERE it.item_id=?",
        [first.id],
      )
    ).some((t) => t.label === "Gifts from Sammy"),
  );
  const originalVersion = read.version;
  await saveItem(
    db,
    {
      ...read.item,
      notes: "Owner correction",
      tagsMode: "manual",
      tags: ["My trip"],
    },
    { id: first.id, version: read.version },
  );
  await assert.rejects(
    saveItem(db, manga, { id: first.id, version: originalVersion }),
    /changed/,
  );
  read = await getItem(db, first.id);
  assert.equal(read.item.notes, "Owner correction");
  assert.deepEqual(read.item.tags, ["My trip"]);
  assert.equal((await getItem(db, duplicate.id)).item.notes, manga.notes);
  const sibling = await getItem(db, duplicate.id);
  await saveItem(
    db,
    { ...read.item, authors: ["Corrected author"] },
    { id: first.id, version: read.version },
  );
  await assert.rejects(
    saveItem(db, sibling.item, { id: duplicate.id, version: sibling.version }),
    /changed/,
  );
  assert.deepEqual((await getItem(db, duplicate.id)).item.authors, [
    "Corrected author",
  ]);
  read = await getItem(db, first.id);
  await assert.rejects(
    saveItem(db, { ...manga, acquiredOn: "2025-02-29" }),
    /valid acquisition date/,
  );
  await assert.rejects(
    saveItem(db, { ...manga, artwork: { url: "http://127.0.0.1/private" } }),
  );
  const cd = itemSchema.parse({
    kind: "cd",
    title: "Persistent album",
    artists: ["Artist"],
    releaseDate: "2024-10",
    editionTitle: "Limited edition",
    labels: [
      { name: "Label", catalogNumber: "CAT-01" },
      { name: "No catalog", catalogNumber: "" },
      { name: "Third label", catalogNumber: "CAT-03" },
    ],
    media: [
      { position: 1, format: "CD" },
      { position: 2, format: "Blu-ray" },
    ],
    tracks: [
      { medium: 1, position: 1, title: "First", durationMs: 123456 },
      { medium: 2, position: 1, title: "Film", durationMs: null },
    ],
    notes: "Korea trip",
    acquiredOn: null,
  });
  const cdId = (await saveItem(db, cd)).id;
  const cdCopy = await getItem(db, cdId);
  assert.equal(cdCopy.item.media[1]?.format, "Blu-ray");
  assert.equal(cdCopy.item.tracks[0]?.durationMs, 123456);
  assert.equal(cdCopy.item.labels[0]?.catalogNumber, "CAT-01");
  assert.equal(cdCopy.item.acquiredOn, null);
  const cdPreview = await createImportPreview(db, {
    kind: "cd",
    filename: "roundtrip.csv",
    text: await exportCsv(db, "cd"),
  });
  assert.equal(cdPreview.errors, 0);
  const cdPlan = await db.all(
    "SELECT payload_json FROM metadata_cache WHERE cache_key=?",
    [`import:${cdPreview.token}`],
  );
  assert.deepEqual(
    JSON.parse(String(cdPlan[0]!.payload_json)).rows[0].item.labels,
    cdCopy.item.labels,
  );
  await saveItem(
    db,
    {
      ...cdCopy.item,
      acquiredOn: "2026-10-23",
      tracks: [
        { medium: 1, position: 1, title: "Corrected track", durationMs: 90000 },
      ],
    },
    { id: cdId, version: cdCopy.version },
  );
  assert.equal(
    (await getItem(db, cdId)).item.tracks[0]?.title,
    "Corrected track",
  );
  const data = await libraryData((sql) => db.all(sql));
  assert.equal(
    data.entries.filter((e) => e.kind === "manga").flatMap((e) => e.copies)
      .length,
    2,
  );
  assert.equal(
    data.entries.filter((e) => e.kind === "cd").flatMap((e) => e.copies).length,
    1,
  );
  await assert.rejects(deleteItem(db, cdId, cdCopy.version), /changed/);
  await deleteItem(db, cdId, (await getItem(db, cdId)).version);
  await deleteItem(db, first.id, read.version);
  await deleteItem(db, duplicate.id, (await getItem(db, duplicate.id)).version);
  assert.deepEqual((await libraryData((sql) => db.all(sql))).entries, []);
}

export async function transferScenario(db: Store, restored: Store) {
  const csv =
    "Title,Volume,Author,Publisher,Date Acquired,Notes,Language\r\n" +
    Array.from(
      { length: 7 },
      (_, i) =>
        `Imported Story,${i + 1},Author,Publisher,10/23/2026,${i === 0 ? "kinokuniya gift" : i === 6 ? "\\/" : "|"},KR`,
    ).join("\r\n");
  const preview = await createImportPreview(db, {
    kind: "manga",
    filename: "manga.csv",
    text: csv,
  });
  assert.equal(preview.total, 7);
  assert.equal(preview.errors, 0);
  let result = await commitImport(db, preview.token, false);
  assert.equal(result.complete, false);
  assert.equal((await pendingImport(db))?.token, preview.token);
  assert.deepEqual((await libraryData((sql) => db.all(sql))).entries, []);
  await assert.rejects(
    saveItem(db, { kind: "cd", title: "Blocked during import" }),
    /import is in progress/,
  );
  result = await commitImport(db, preview.token, false);
  assert.equal(result.complete, true);
  assert.equal(await pendingImport(db), null);
  const provenance = await db.all(
    "SELECT source_row_json FROM import_records WHERE source_record_number=1",
  );
  assert.equal(
    JSON.parse(String(provenance[0]?.source_row_json))["Title"],
    "Imported Story",
  );
  assert.equal(
    (await libraryData((sql) => db.all(sql))).entries[0]?.copies.length,
    7,
  );
  assert.equal((await commitImport(db, preview.token, false)).added, 0);
  const repeat = await createImportPreview(db, {
    kind: "manga",
    filename: "again.csv",
    text: csv,
  });
  assert.equal(repeat.duplicates, 7);
  const copiedCsv = await exportCsv(db, "manga");
  const exportPreview = await createImportPreview(db, {
    kind: "manga",
    filename: "export.csv",
    text: copiedCsv,
  });
  assert.equal(exportPreview.errors, 0);
  assert.equal(exportPreview.duplicates, 7);
  assert.ok(exportPreview.rows.every((r) => r.existingId));
  const discogs = await createImportPreview(db, {
    kind: "discogs",
    filename: "discogs.csv",
    text: "Artist,Title,Label,Catalogno,Format,Released,Date Added,Collection Notes\nArtist,Discogs album,Label,CAT-123,CD,2023,2026-10-23 12:00:00,From a trip",
  });
  await commitImport(db, discogs.token, false);
  const album = (await libraryData((sql) => db.all(sql))).entries.find(
    (e) => e.kind === "cd",
  )!;
  const copy = await getItem(db, album.copies[0]!.id);
  assert.equal(copy.item.acquiredOn, null);
  assert.match(copy.item.notes!, /Date Added: 2026-10-23/);
  assert.match(copy.item.notes!, /From a trip/);
  assert.equal(copy.item.labels[0]?.catalogNumber, "CAT-123");
  const backup = await exportBackup(db);
  await restoreBackup(restored, backup, await revision(restored));
  const restoredBackup = await exportBackup(restored);
  assert.deepEqual(restoredBackup.tables, backup.tables);
  assert.equal((await restoreBackup(restored, backup, 0)).added, 0);
  const edited = await getItem(restored, album.copies[0]!.id);
  await saveItem(
    restored,
    { ...edited.item, notes: "new owner edit" },
    { id: album.copies[0]!.id, version: edited.version },
  );
  await assert.rejects(
    restoreBackup(restored, backup, await revision(restored)),
    /conflicts/,
  );
  const invalid = await createImportPreview(db, {
    kind: "manga",
    filename: "bad.csv",
    text: "Title,Volume,Author,Publisher,Date Acquired,Notes\nBad,1,A,P,2/30/2024,Hello",
  });
  assert.equal(invalid.errors, 1);
  await assert.rejects(
    commitImport(db, invalid.token, false),
    /Correct every invalid/,
  );
  const cancel = await createImportPreview(db, {
    kind: "manga",
    filename: "cancel.csv",
    text: csv.replaceAll("Imported Story", "Cancelled story"),
  });
  await commitImport(db, cancel.token, false);
  await cancelImport(db, cancel.token);
  assert.equal(
    (await libraryData((sql) => db.all(sql))).entries.some(
      (e) => e.title === "Cancelled story",
    ),
    false,
  );
  await saveItem(db, { kind: "cd", title: "Unblocked" });
}
