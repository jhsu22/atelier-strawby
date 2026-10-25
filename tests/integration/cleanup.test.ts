import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { normalizeCsv } from "../../scripts/lib/normalize.ts";
import { persistPlan } from "../../scripts/lib/import.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";
import { saveHaul } from "../../src/server/services/hauls.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { applyCleanup } from "../../src/server/services/cleanup.ts";
import { exportBackup, restoreBackup } from "../../src/server/services/backup.ts";
import { coverCandidates } from "../../src/server/metadata/cover-utility.ts";
import { revision } from "../../src/server/db/store.ts";
import type { Store } from "../../src/server/db/store.ts";
import { cleanupQueue } from "../../src/domain/cleanup.ts";
import type { EditionTask } from "../../src/domain/cleanup.ts";
import { collectionAnalytics } from "../../src/domain/collection-insights.ts";
import type { MangaCopy } from "../../src/domain/library.ts";
import { mangaDex } from "../helpers/cover-scenario.ts";

const plan = normalizeCsv(readFileSync("initial_collection.csv", "utf8"));
const owner = (db: Store) => libraryData((sql) => db.all(sql), { owner: true });
const queue = async (db: Store) => cleanupQueue((await owner(db)).entries);
const copy = async (db: Store, id: string) =>
  (await owner(db)).entries.flatMap((entry) => entry.copies).find((entry) => entry.id === id) as MangaCopy;
const seen = (copy: MangaCopy) => ({
  language: copy.language,
  languageBasis: copy.languageBasis,
  format: copy.format as "standard",
  numberingBasis: copy.numberingBasis,
});

test("the queue matches the stats caveats, and edition fixes update every copy in place", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await persistPlan(db, plan);
    const entries = (await owner(db)).entries;
    const stats = collectionAnalytics(entries);
    const before = cleanupQueue(entries);
    const copies = (tasks: EditionTask[]) => tasks.reduce((sum, task) => sum + task.copies.length, 0);
    assert.equal(copies(before.language as EditionTask[]), stats.assumedLanguages);
    assert.equal(copies(before.numbering as EditionTask[]), stats.uncertainNumbering);
    assert.equal(before.date.reduce((sum, task) => sum + (task.kind === "date" ? task.items.length : 0), 0), stats.undated);
    assert.ok(before.language.length < stats.assumedLanguages, "one card per edition, not per copy");

    const task = before.language[0] as EditionTask;
    const ids = task.copies.map((entry) => entry.id);
    const versions = task.copies.map((entry) => entry.version);
    await assert.rejects(
      applyCleanup(db, { action: "edition", runId: task.runId, seen: { ...seen(task.copies[0]!), language: "KR" }, language: "EN" }),
      /changed since this page loaded/,
    );
    await applyCleanup(db, { action: "edition", runId: task.runId, seen: seen(task.copies[0]!), language: "JP" });
    for (const [index, id] of ids.entries()) {
      const updated = await copy(db, id);
      assert.equal(updated.editionRunId, task.runId, "the run keeps its identity");
      assert.equal(updated.language, "JP");
      assert.equal(updated.languageBasis, "confirmed");
      assert.equal(updated.version, versions[index]! + 1, "open editor forms become stale");
    }
    const after = await queue(db);
    assert.equal(after.language.length, before.language.length - 1);
    assert.ok(!after.language.some((entry) => entry.key === task.key));

    const numbering = before.numbering[0] as EditionTask;
    await applyCleanup(db, { action: "edition", runId: numbering.runId, seen: seen(numbering.copies[0]!), format: "omnibus", numberingBasis: "printed" });
    const fixed = await copy(db, numbering.copies[0]!.id);
    assert.deepEqual([fixed.format, fixed.numberingBasis], ["omnibus", "printed"]);
    assert.equal((await queue(db)).numbering.length, before.numbering.length - 1);
    await assert.rejects(applyCleanup(db, { action: "edition", runId: numbering.runId, seen: seen(fixed) }), /Choose what to confirm/);
    assert.deepEqual(await db.all("PRAGMA foreign_key_check"), []);
  } finally {
    await db.close();
  }
});

test("confirming an edition merges it into an identical owned edition without duplicating volumes", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const series = { kind: "manga", title: "Merge Story", publisher: "House", language: "EN" };
    const assumed1 = await saveItem(db, { ...series, volume: "1", languageBasis: "assumed", isbn13: "9781974709946" });
    const assumed2 = await saveItem(db, { ...series, volume: "2", languageBasis: "assumed" });
    const confirmed2 = await saveItem(db, { ...series, volume: "2", languageBasis: "confirmed" });
    const target = (await copy(db, confirmed2.id)).editionRunId;
    const task = (await queue(db)).language.find((entry) => entry.kind === "language" && entry.copies.some((c) => c.id === assumed1.id)) as EditionTask;
    await applyCleanup(db, { action: "edition", runId: task.runId, seen: seen(task.copies[0]!), language: "EN" });
    const merged = await Promise.all([assumed1.id, assumed2.id, confirmed2.id].map((id) => copy(db, id)));
    assert.ok(merged.every((entry) => entry.editionRunId === target));
    assert.equal(merged[0]!.isbn13, "9781974709946", "the moved volume keeps its ISBN");
    assert.deepEqual(await db.all("SELECT id FROM edition_runs WHERE id=?", [task.runId]), []);
    const volumeTwo = await db.all(
      "SELECT DISTINCT v.volume_edition_id FROM volumes v WHERE v.item_id IN (?,?)",
      [assumed2.id, confirmed2.id],
    );
    assert.equal(volumeTwo.length, 1, "both copies of volume 2 share one volume edition");
    assert.equal((await queue(db)).language.length, 0);
    assert.deepEqual(await db.all("PRAGMA foreign_key_check"), []);
  } finally {
    await db.close();
  }
});

test("dates are set or remembered as unknown, per copy or for a whole logged haul", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const single = await saveItem(db, { kind: "manga", title: "Dates", volume: "1" });
    const other = await saveItem(db, { kind: "cd", title: "Undated CD" });
    const haul = await saveHaul(db, {
      haul: { id: crypto.randomUUID(), acquiredOn: null, items: [{ kind: "manga", title: "Haul", volume: "1" }, { kind: "manga", title: "Haul", volume: "2" }] },
      requestId: crypto.randomUUID(),
    });
    const tasks = (await queue(db)).date;
    assert.equal(tasks.length, 3, "the haul is one card");
    const haulTask = tasks.find((task) => task.kind === "date" && task.haul);
    assert.equal(haulTask?.kind === "date" && haulTask.items.length, 2);
    await assert.rejects(applyCleanup(db, { action: "date", copyId: single.id, version: 7, acquiredOn: "2024-02-29" }), /changed since/);
    await applyCleanup(db, { action: "date", copyId: single.id, version: 1, acquiredOn: "2024-02-29" });
    assert.equal((await getItem(db, single.id)).item.acquiredOn, "2024-02-29");
    await applyCleanup(db, { action: "date", copyId: haul.ids[0]!, version: 1, acquiredOn: "2023-12-25" });
    for (const id of haul.ids) assert.equal((await getItem(db, id)).item.acquiredOn, "2023-12-25");
    assert.equal((await db.all("SELECT acquired_on FROM acquisition_batches"))[0]!.acquired_on, "2023-12-25");
    await applyCleanup(db, { action: "date", copyId: other.id, version: 1, acquiredOn: null });
    assert.equal((await queue(db)).date.length, 0);
    const entries = (await owner(db)).entries;
    assert.equal(collectionAnalytics(entries).undated, 1, "stats still count a date nobody knows");
    assert.equal((await libraryData((sql) => db.all(sql))).entries.flatMap((entry) => entry.copies).some((entry) => "dateUnknown" in entry), false, "flags stay off the public shelf");
    // Recording a date later in the editor clears "unknown".
    const current = await getItem(db, other.id);
    await saveItem(db, { ...current.item, acquiredOn: "2020-01-01" }, { id: other.id, version: current.version });
    await saveItem(db, { ...current.item, acquiredOn: null }, { id: other.id, version: current.version + 1 });
    assert.equal((await queue(db)).date.length, 1);
  } finally {
    await db.close();
  }
});

test("covers are confirmed for one volume only, removed, marked unavailable or chosen from candidates", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const artwork = { url: "https://covers.openlibrary.org/b/id/42-L.jpg", provider: "openlibrary", scope: "representative" };
    const one = await saveItem(db, { kind: "manga", title: "Covers", volume: "1", artwork });
    const two = await saveItem(db, { kind: "manga", title: "Covers", volume: "2", artwork });
    const asset = (await db.all("SELECT cover_asset_id AS id FROM volume_editions"))[0]!.id as string;
    await db.batch([{ sql: "UPDATE cover_variants SET object_key='covers/abc',external_url=NULL WHERE cover_asset_id=?", params: [asset] }]);
    assert.equal((await queue(db)).cover.length, 2);
    await applyCleanup(db, { action: "cover", copyId: one.id, version: 1, decision: "confirm" });
    const confirmed = await getItem(db, one.id);
    assert.equal(confirmed.item.artwork?.scope, "edition");
    assert.equal((await getItem(db, two.id)).item.artwork?.scope, "representative", "a shared asset is not confirmed for other volumes");
    const variant = (await db.all("SELECT a.storage_mode,v.object_key FROM volumes vo JOIN volume_editions e ON e.id=vo.volume_edition_id JOIN cover_assets a ON a.id=e.cover_asset_id JOIN cover_variants v ON v.cover_asset_id=a.id WHERE vo.item_id=?", [one.id]))[0]!;
    assert.deepEqual([variant.storage_mode, variant.object_key], ["r2", "covers/abc"], "cached bytes are reused");
    // An editor re-save of the confirmed cover keeps the same asset.
    const assets = (await db.all("SELECT COUNT(*) AS n FROM cover_assets"))[0]!.n;
    await saveItem(db, confirmed.item, { id: one.id, version: confirmed.version });
    assert.equal((await db.all("SELECT COUNT(*) AS n FROM cover_assets"))[0]!.n, assets);

    await applyCleanup(db, { action: "cover", copyId: two.id, version: 1, decision: "remove" });
    let current = await queue(db);
    assert.equal(current.cover.length, 0);
    assert.equal(current["missing-cover"].length, 1);
    await assert.rejects(applyCleanup(db, { action: "cover", copyId: two.id, version: 2, decision: "confirm" }), /already removed/);
    await applyCleanup(db, { action: "cover", copyId: two.id, version: 2, decision: "unavailable" });
    assert.equal((await queue(db))["missing-cover"].length, 0);
    await applyCleanup(db, {
      action: "apply-cover",
      copyId: two.id,
      version: 3,
      artwork: { url: "https://covers.openlibrary.org/b/id/43-L.jpg", provider: "openlibrary", sourceId: "/books/OL43M" },
    });
    current = await queue(db);
    assert.equal((await getItem(db, two.id)).item.artwork?.scope, "edition");
    assert.equal((await db.all("SELECT cover_unavailable FROM volume_editions WHERE cover_asset_id IS NOT NULL AND cover_unavailable=1")).length, 0);
    await assert.rejects(
      applyCleanup(db, { action: "apply-cover", copyId: two.id, version: 4, artwork: { url: "https://covers.openlibrary.org/b/id/44-L.jpg" } }),
      /has a cover now/,
    );
    const cd = await saveItem(db, { kind: "cd", title: "No art" });
    assert.equal((await queue(db))["missing-cover"].length, 1);
    assert.deepEqual((await coverCandidates(db, { copyId: cd.id })).candidates, []);
    await applyCleanup(db, { action: "cover", copyId: cd.id, version: 1, decision: "unavailable" });
    assert.equal((await queue(db))["missing-cover"].length, 0);
  } finally {
    await db.close();
  }
});

test("cover candidates offer near matches with exact ones first", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const saved = await saveItem(db, { kind: "manga", title: "Story", authors: ["Yoshitoki Ōima"], publisher: "Publisher", volume: "2" });
    const result = await coverCandidates(db, { copyId: saved.id }, { fetcher: mangaDex });
    assert.ok(result.candidates.length >= 2);
    assert.equal(result.candidates[0]!.exact, true, "the matching Open Library publisher ranks first");
    assert.ok(result.candidates.some((candidate) => candidate.artwork.provider === "mangadex" && !candidate.exact), "MangaDex covers for other volumes are offered as near matches");
    assert.equal(new Set(result.candidates.map((candidate) => candidate.artwork.url)).size, result.candidates.length);
    const failing = await coverCandidates(db, { copyId: saved.id, retry: true }, { fetcher: async () => new Response("", { status: 500 }) });
    assert.deepEqual(failing.candidates, []);
    assert.ok(failing.warnings.length > 0);
  } finally {
    await db.close();
  }
});

test("clean-up flags survive a backup round trip, and older backups restore with them cleared", async () => {
  const db = openSqlite(":memory:"),
    restored = openSqlite(":memory:"),
    legacy = openSqlite(":memory:");
  try {
    for (const target of [db, restored, legacy]) await migrateSqlite(target);
    const undated = await saveItem(db, { kind: "manga", title: "Flags", volume: "1" });
    await applyCleanup(db, { action: "date", copyId: undated.id, version: 1, acquiredOn: null });
    await applyCleanup(db, { action: "cover", copyId: undated.id, version: 2, decision: "unavailable" });
    const backup = await exportBackup(db);
    await restoreBackup(restored, backup, await revision(restored));
    assert.deepEqual(await queue(restored), await queue(db));
    for (const row of backup.tables.collection_items!) delete row.date_unknown;
    for (const row of backup.tables.volume_editions!) delete row.cover_unavailable;
    for (const row of backup.tables.album_releases!) delete row.cover_unavailable;
    await restoreBackup(legacy, backup, await revision(legacy));
    const reopened = await queue(legacy);
    assert.equal(reopened.date.length, 1);
    assert.equal(reopened["missing-cover"].length, 1);
  } finally {
    for (const target of [db, restored, legacy]) await target.close();
  }
});
