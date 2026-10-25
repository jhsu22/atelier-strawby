import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { normalizeCsv } from "../../scripts/lib/normalize.ts";
import { persistPlan } from "../../scripts/lib/import.ts";
import { seedSampleCds } from "../../scripts/lib/sample-cds.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { seriesGaps } from "../../src/domain/library.ts";
import { librarySchema } from "../../src/domain/library-schema.ts";

const plan = normalizeCsv(readFileSync("initial_collection.csv", "utf8"));
test("library read service returns all real copies, multilingual editions, corrected credits and unresolved sample CDs", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await persistPlan(db, plan);
    await seedSampleCds(db);
    const data = librarySchema.parse(
      await libraryData((sql) => db.all(sql), { owner: true }),
    );
    const manga = data.entries.filter((entry) => entry.kind === "manga");
    const cds = data.entries.filter((entry) => entry.kind === "cd");
    assert.equal(manga.length, 38);
    assert.equal(manga.flatMap((entry) => entry.copies).length, 177);
    assert.equal(cds.length, 4);
    const sign = manga.find((entry) => entry.title === "A Sign of Affection")!;
    assert.equal(sign.copies.length, 10);
    assert.deepEqual(
      sign.copies.reduce<Record<string, number>>(
        (counts, copy) => ({
          ...counts,
          [copy.language]: (counts[copy.language] ?? 0) + 1,
        }),
        {},
      ),
      { EN: 8, JP: 1, KR: 1 },
    );
    const guy = manga.find((entry) =>
      entry.title.startsWith("The Guy She Was Interested"),
    )!;
    assert.equal(guy.copies.filter((copy) => copy.volume === "1").length, 2);
    assert.equal(
      guy.copies.filter((copy) => copy.acquiredOn === null).length,
      1,
    );
    assert.deepEqual(
      manga.find((entry) => entry.title === "SPY x FAMILY")!.authors,
      ["Tatsuya Endo"],
    );
    assert.deepEqual(
      seriesGaps(manga.find((entry) => entry.title === "86: EIGHTY-SIX")!)[0]!
        .missing,
      ["5–6"],
    );
    assert.ok(
      seriesGaps(manga.find((entry) => entry.title === "Steins;Gate")!).every(
        (group) => group.uncertain,
      ),
    );
    assert.ok(
      cds.every(
        (entry) =>
          entry.tracks.length === 0 &&
          entry.releaseDate === null &&
          entry.labels.length === 0 &&
          entry.formats.length === 0 &&
          entry.copies.every((copy) => copy.isSample),
      ),
    );
    assert.equal(
      manga
        .flatMap((entry) => entry.copies)
        .filter((copy) => copy.notes === "from sammy <3").length,
      5,
    );
  } finally {
    await db.close();
  }
});
test("library reads hide incomplete imports and reflect later persisted changes", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    assert.deepEqual(await libraryData((sql) => db.all(sql)), { entries: [] });
    await persistPlan(db, plan);
    await db.batch([
      {
        sql: "UPDATE collection_items SET notes = ? WHERE id = ?",
        params: ["Updated memory <3", plan.copies[0]!.itemId],
      },
    ]);
    let data = await libraryData((sql) => db.all(sql), { owner: true });
    assert.ok(
      data.entries.some((entry) =>
        entry.copies.some((copy) => copy.notes === "Updated memory <3"),
      ),
    );
    await db.batch([
      { sql: "UPDATE import_batches SET status = 'committing'", params: [] },
    ]);
    data = await libraryData((sql) => db.all(sql));
    assert.deepEqual(data.entries, []);
  } finally {
    await db.close();
  }
});
test("library service rejects invalid database languages instead of serializing unchecked DTOs", async () => {
  await assert.rejects(
    libraryData(async (sql) =>
      sql.includes("canonical_title") ? [{ language: "invalid" }] : [],
    ),
  );
});

test("library read service orders populated multi-disc tracklists and retains release metadata", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await seedSampleCds(db);
    const before = await libraryData((sql) => db.all(sql));
    const release = before.entries.find(
      (entry) => entry.kind === "cd" && entry.title === "Kessoku Band",
    )!;
    await db.batch([
      {
        sql: "INSERT INTO labels(id,name,normalized_name) VALUES ('audit-label','Synthetic audit label','synthetic audit label')",
        params: [],
      },
      {
        sql: "INSERT INTO release_labels(id,release_id,label_id,catalog_number,credit_order) VALUES ('audit-label-credit',?,'audit-label','TEST-0001',0)",
        params: [release.id],
      },
      {
        sql: "UPDATE album_releases SET release_date='2001-05-06', date_precision='day' WHERE id=?",
        params: [release.id],
      },
      {
        sql: "INSERT INTO release_media(id,release_id,position,format) VALUES ('audit-disc-2',?,2,'DVD')",
        params: [release.id],
      },
      {
        sql: "INSERT INTO release_media(id,release_id,position,format) VALUES ('audit-disc-1',?,1,'CD')",
        params: [release.id],
      },
      {
        sql: "INSERT INTO tracks(id,medium_id,position,title,duration_ms) VALUES ('audit-encore','audit-disc-2',1,'Synthetic encore',61000)",
        params: [],
      },
      {
        sql: "INSERT INTO tracks(id,medium_id,position,title,duration_ms) VALUES ('audit-unknown','audit-disc-1',2,'Synthetic interlude',NULL)",
        params: [],
      },
      {
        sql: "INSERT INTO tracks(id,medium_id,position,title,duration_ms) VALUES ('audit-opening','audit-disc-1',1,'Synthetic opening',125000)",
        params: [],
      },
    ]);
    const after = librarySchema.parse(await libraryData((sql) => db.all(sql)));
    const album = after.entries.find((entry) => entry.id === release.id)!;
    assert.equal(album.kind, "cd");
    if (album.kind !== "cd") throw new Error("Expected CD release");
    assert.equal(album.releaseDate, "2001-05-06");
    assert.deepEqual(album.formats, ["CD", "DVD"]);
    assert.deepEqual(album.labels, ["Synthetic audit label"]);
    assert.deepEqual(album.catalogNumbers, ["TEST-0001"]);
    assert.deepEqual(
      album.tracks.map((track) => [
        track.medium,
        track.position,
        track.title,
        track.durationMs,
      ]),
      [
        [1, 1, "Synthetic opening", 125000],
        [1, 2, "Synthetic interlude", null],
        [2, 1, "Synthetic encore", 61000],
      ],
    );
  } finally {
    await db.close();
  }
});
