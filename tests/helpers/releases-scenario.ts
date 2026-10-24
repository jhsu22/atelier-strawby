import assert from "node:assert/strict";
import type { Store } from "../../src/server/db/store.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";
import { libraryData } from "../../src/server/services/library.ts";
import { lookupReleasedVolumes, readReleaseCatalog } from "../../src/server/metadata/releases.ts";
import { compareReleases } from "../../src/domain/releases.ts";

const key = "synthetic-not-a-real-key";
export const googleVolume = (number: number, extra: Record<string, unknown> = {}, id = `v${number}`) => ({id, volumeInfo: {title: `Catalog Story Vol. ${number}`, authors: ["Catalog Author"], publisher: "Kodansha", language: "en", publishedDate: "2025-01-01", ...extra}});
export async function releasesScenario(db: Store) {
  const base = {kind: "manga", title: "Catalog Story", authors: ["Catalog Author"], publisher: "Kodansha", language: "EN"};
  const first = await saveItem(db, {...base, volume: "2"});
  await saveItem(db, {...base, volume: "3"});
  await saveItem(db, {...base, volume: "3"});
  await saveItem(db, {...base, volume: "1", language: "JP"});
  const before = await libraryData(q => db.all(q));
  const entry = before.entries.find(entry => entry.kind === "manga" && entry.title === base.title)!;
  if (entry.kind !== "manga") throw new Error("Expected manga");
  const run = entry.copies.find(copy => copy.language === "EN")!.editionRunId;
  let calls = 0;
  const fetcher: typeof fetch = async (address, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("X-Goog-Api-Key"), key);
    assert.equal(new URL(String(address)).searchParams.get("showPreorders"), "false");
    return Response.json({totalItems: 16, items: [
      googleVolume(1), googleVolume(2), googleVolume(3), googleVolume(4), googleVolume(4, {}, "reprint4"),
      googleVolume(5, {publishedDate: "2030-01-01"}), googleVolume(6, {publishedDate: "2025"}),
      googleVolume(7, {publishedDate: "2026-09"}), googleVolume(8, {publishedDate: "2026-10"}),
      googleVolume(9, {publishedDate: "2026-02-30"}), googleVolume(10, {publishedDate: ""}),
      googleVolume(11, {language: "ja"}), googleVolume(12, {publisher: "Other publisher"}),
      googleVolume(13, {authors: ["Different person"]}), googleVolume(14, {title: "Catalog Story Omnibus Vol 14"}),
      {...googleVolume(15), saleInfo: {isEbook: true}},
    ]});
  };
  assert.equal(await readReleaseCatalog(db, run), null);
  const result = await lookupReleasedVolumes(db, {editionRunId: run}, {googleBooksKey: key, fetcher, today: "2026-10-24"});
  assert.equal(result.provider, "googlebooks");
  assert.equal(result.nextOffset, null);
  assert.equal(result.scanned, 16);
  assert.equal(result.excluded, 8);
  const comparison = compareReleases(entry.copies, result, "2026-10-24");
  assert.deepEqual(comparison.released.map(v => v.number), [1,2,3,4,6,7,15]);
  assert.deepEqual(comparison.missing.map(v => v.number), [1,4,6,7,15]);
  assert.equal(result.volumes.find(v => v.number === 15)!.digital, true);
  assert.deepEqual(await readReleaseCatalog(db, run), result);
  await lookupReleasedVolumes(db, {editionRunId: run}, {googleBooksKey: key, fetcher, today: "2026-10-24"});
  assert.equal(calls, 1, "provider response is cached");
  await saveItem(db, {...base, volume: "4"});
  const updated = (await libraryData(q => db.all(q))).entries.find(candidate => candidate.id === entry.id)!;
  if (updated.kind !== "manga") throw new Error("Expected manga");
  assert.deepEqual(compareReleases(updated.copies, (await readReleaseCatalog(db, run))!, "2026-10-24").missing.map(v => v.number), [1,6,7,15]);
  assert.equal(calls, 1, "ownership changes recompute without a provider call");
  const item = await getItem(db, first.id);
  await saveItem(db, {...item.item, authors: ["Revised Catalog Author"]}, {id: first.id, version: item.version});
  assert.equal(await readReleaseCatalog(db, run), null, "metadata changes invalidate the scope fingerprint");
  await assert.rejects(lookupReleasedVolumes(db, {editionRunId: "not-owned"}, {googleBooksKey: key, fetcher}), /No collected/);
  assert.ok(!JSON.stringify(await db.all("SELECT * FROM metadata_cache")).includes(key));
}
