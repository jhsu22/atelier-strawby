import assert from "node:assert/strict";
import test from "node:test";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";
import { lookupCdBarcode } from "../../src/server/scan/cd.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { commitImport, createImportPreview, exportCsv } from "../../src/server/services/transfer.ts";
import type { Fetcher } from "../../src/server/metadata/http.ts";

const EAN = "4547366423815";
const UPC_A = "074644057829";
const release = (id: string, barcode: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: "Kessoku Band",
  barcode,
  date: "2022-12-28",
  country: "JP",
  "artist-credit": [{ name: "Kessoku Band", artist: { name: "結束バンド" } }],
  "label-info": [{ "catalog-number": "SVWC-70630", label: { name: "Aniplex" } }],
  media: [{ format: "CD", "track-count": 14 }],
  "track-count": 14,
  ...extra,
});
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
function musicBrainz(requests: string[]): Fetcher {
  return async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith("https://musicbrainz.org/ws/2/release/?query="))
      return Response.json({
        releases: decodeURIComponent(url).includes(EAN)
          ? [release(A, EAN), release(B, EAN, { country: "XW", "label-info": [] }), release("33333333-3333-4333-8333-333333333333", "4547366000000")]
          : decodeURIComponent(url).includes(UPC_A)
            ? [release(A, UPC_A, { title: "Ride the Lightning", "artist-credit": [{ name: "Metallica" }] })]
            : [],
      });
    return new Response("unexpected", { status: 500 });
  };
}

test("a CD barcode finds MusicBrainz releases listing it, and a recorded barcode answers from the shelf", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const requests: string[] = [];
    const fetcher = musicBrainz(requests);
    const first = await lookupCdBarcode(db, { code: EAN, source: "camera" }, { fetcher });
    assert.deepEqual(first.releases.map((entry) => entry.id), [A, B], "a fuzzy match with another barcode is dropped");
    assert.deepEqual(first.releases[0]!.labels, [{ name: "Aniplex", catalogNumber: "SVWC-70630" }]);
    assert.equal(first.releases[0]!.trackCount, 14);
    assert.deepEqual(first.owned, []);
    assert.equal(first.local, false);
    // UPC-A searches both printed forms and stores the 13-digit one.
    const upc = await lookupCdBarcode(db, { code: UPC_A, source: "manual" }, { fetcher });
    assert.equal(upc.barcode, `0${UPC_A}`);
    assert.match(decodeURIComponent(requests.at(-1)!), new RegExp(`barcode:0${UPC_A} OR barcode:${UPC_A}`));
    assert.equal(upc.releases.length, 1);

    // An owned pressing of the same album without a barcode is noted.
    await saveItem(db, { kind: "cd", title: "Kessoku Band", artists: ["Kessoku Band"] });
    assert.equal((await lookupCdBarcode(db, { code: EAN, source: "camera" }, { fetcher })).albums.length, 1);
    const saved = await saveItem(db, { kind: "cd", title: "Kessoku Band", artists: ["Kessoku Band"], barcode: EAN, labels: [{ name: "Aniplex", catalogNumber: "SVWC-70630" }] });
    assert.equal((await getItem(db, saved.id)).item.barcode, EAN);
    const before = requests.length;
    const rescan = await lookupCdBarcode(db, { code: EAN, source: "camera" }, { fetcher });
    assert.equal(requests.length, before, "no provider request for a recorded barcode");
    assert.equal(rescan.local, true);
    assert.deepEqual(rescan.owned.map((copy) => copy.id), [saved.id]);
    const retried = await lookupCdBarcode(db, { code: EAN, source: "camera", retry: true }, { fetcher });
    assert.equal(retried.releases.length, 2);
    assert.equal(retried.albums.length, 1, "the barcode's own release is not 'another edition'");

    const missing = await lookupCdBarcode(db, { code: "4988031000007", source: "manual" }, { fetcher });
    assert.deepEqual([missing.releases, missing.failures], [[], []]);
    assert.match(missing.warnings.join(" "), /doesn’t list this barcode/);
    await assert.rejects(lookupCdBarcode(db, { code: "9781974715466", source: "manual" }, { fetcher }), /ISBN/);
    await assert.rejects(lookupCdBarcode(db, { code: "4547366423816", source: "manual" }, { fetcher }), /check digit/);
    const down = await lookupCdBarcode(db, { code: UPC_A, source: "manual", retry: true }, { fetcher: async () => new Response("", { status: 503 }) });
    assert.deepEqual(down.releases, []);
    assert.equal(down.failures[0]?.provider, "musicbrainz");
    assert.ok(down.warnings.length);
  } finally {
    await db.close();
  }
});

test("a CD's barcode is kept by the shelf, the editor, CSV and reimport, without changing older release identities", async () => {
  const db = openSqlite(":memory:"),
    imported = openSqlite(":memory:");
  try {
    for (const target of [db, imported]) await migrateSqlite(target);
    const plain = await saveItem(db, { kind: "cd", title: "No barcode" });
    const plainRelease = (await db.all("SELECT release_id FROM cds WHERE item_id=?", [plain.id]))[0]!.release_id;
    const current = await getItem(db, plain.id);
    await saveItem(db, current.item, { id: plain.id, version: current.version });
    assert.equal((await db.all("SELECT release_id FROM cds WHERE item_id=?", [plain.id]))[0]!.release_id, plainRelease);
    const coded = await saveItem(db, { kind: "cd", title: "Ride the Lightning", artists: ["Metallica"], barcode: UPC_A });
    const album = (await libraryData((sql) => db.all(sql))).entries.find((entry) => entry.kind === "cd" && entry.title === "Ride the Lightning");
    assert.equal(album?.kind === "cd" && album.barcode, `0${UPC_A}`);
    const csv = await exportCsv(db, "cd");
    assert.ok(csv.includes('"Barcode"') && csv.includes(`"${UPC_A}"`), "CSV shows the barcode as printed");
    const preview = await createImportPreview(imported, { kind: "cd", filename: "cds.csv", text: csv });
    assert.equal(preview.errors, 0);
    while (!(await commitImport(imported, preview.token, false)).complete);
    const restored = (await libraryData((sql) => imported.all(sql))).entries.find((entry) => entry.kind === "cd" && entry.title === "Ride the Lightning");
    assert.equal(restored?.kind === "cd" && restored.barcode, `0${UPC_A}`);
    assert.ok(coded.id);
  } finally {
    for (const target of [db, imported]) await target.close();
  }
});
