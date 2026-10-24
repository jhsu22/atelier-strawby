import test from "node:test";
import assert from "node:assert/strict";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { releasesScenario, googleVolume } from "../helpers/releases-scenario.ts";
import { saveItem } from "../../src/server/services/items.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { lookupReleasedVolumes, readReleaseCatalog } from "../../src/server/metadata/releases.ts";

test("released-volume catalog persists in SQLite, compares current edition ownership and invalidates changed metadata", async () => {
  const db = openSqlite(":memory:");
  try { await migrateSqlite(db); await releasesScenario(db); } finally { await db.close(); }
});
async function fixture() {
  const db = openSqlite(":memory:"); await migrateSqlite(db);
  await saveItem(db, {kind: "manga", title: "Catalog Story", authors: ["Catalog Author"], publisher: "Kodansha", volume: "2"});
  const entry = (await libraryData(q => db.all(q))).entries[0]!;
  if (entry.kind !== "manga") throw new Error("Expected manga");
  return {db, run: entry.copies[0]!.editionRunId};
}
test("catalog paging follows individual results, persists continuation and handles repeated pages without inventing a total", async () => {
  const {db, run} = await fixture();
  try {
    const fetcher: typeof fetch = async address => {
      const offset = Number(new URL(String(address)).searchParams.get("startIndex"));
      return Response.json({totalItems: 5, items: [googleVolume(offset + 1)]});
    };
    const options = {googleBooksKey: "fake", fetcher, today: "2026-10-24"};
    const first = await lookupReleasedVolumes(db, {editionRunId: run}, options);
    assert.equal(first.scanned, 4); assert.equal(first.nextOffset, 4);
    const second = await lookupReleasedVolumes(db, {editionRunId: run, continuation: true}, options);
    assert.equal(second.scanned, 5); assert.equal(second.nextOffset, null);
    assert.deepEqual(second.volumes.map(v => v.number), [1,2,3,4,5]);
    await assert.rejects(lookupReleasedVolumes(db, {editionRunId: run, continuation: true}, options), /No catalog lookup/);
    const repeated = await lookupReleasedVolumes(db, {editionRunId: run, retry: true}, {...options, fetcher: async () => Response.json({totalItems: 500, items: [googleVolume(1)]})});
    assert.equal(repeated.nextOffset, null); assert.match(repeated.warnings.join(), /repeated a page/);
  } finally { await db.close(); }
});
test("partial failures retain prior evidence and allow retry, while failed refresh preserves the saved catalog", async () => {
  const {db, run} = await fixture();
  try {
    const result = await lookupReleasedVolumes(db, {editionRunId: run, provider: "googlebooks"}, {googleBooksKey: "fake", fetcher: async address => {
      return Number(new URL(String(address)).searchParams.get("startIndex")) === 0 ? Response.json({totalItems: 80, items: [googleVolume(1)]}) : new Response("unavailable", {status: 500});
    }});
    assert.equal(result.volumes.length, 1); assert.equal(result.nextOffset, 1);
    assert.match(result.warnings.join(), /scan is partial/);
    const recovered = await lookupReleasedVolumes(db, {editionRunId: run, continuation: true, retry: true}, {googleBooksKey: "fake", fetcher: async () => Response.json({totalItems: 2, items: [googleVolume(2)]})});
    assert.equal(recovered.nextOffset, null);
    assert.ok(!recovered.warnings.some(warning => warning.startsWith("The scan is partial.") || warning.startsWith("Catalog page issue:")));
    await assert.rejects(lookupReleasedVolumes(db, {editionRunId: run, provider: "googlebooks", retry: true}, {googleBooksKey: "fake", fetcher: async () => new Response("failure", {status: 500})}));
    assert.deepEqual(await readReleaseCatalog(db, run), recovered);
  } finally { await db.close(); }
});
test("missing Google credentials and access failures fall back to Open Library edition evidence", async () => {
  for (const googleBooksKey of [undefined, "fake"]) {
    const {db, run} = await fixture();
    try {
      const result = await lookupReleasedVolumes(db, {editionRunId: run}, {googleBooksKey, fetcher: async address => {
        if (String(address).includes("googleapis")) return Response.json({error: {errors: [{reason: "keyInvalid"}]}}, {status: 403});
        return Response.json({numFound: 1, docs: [{key: "/works/OL1W", author_name: ["Catalog Author"], editions: {docs: [{key: "/books/OL1M", title: "Catalog Story Vol 1", publisher: ["Kodansha"], language: ["eng"], publish_date: ["January 1, 2025"]}]}}]});
      }});
      assert.equal(result.provider, "openlibrary"); assert.equal(result.volumes[0]!.number, 1);
      assert.ok(result.warnings.length);
    } finally { await db.close(); }
  }
});
