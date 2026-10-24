import assert from "node:assert/strict";
import type { Store } from "../../src/server/db/store.ts";
import { saveItem, getItem } from "../../src/server/services/items.ts";
import { cacheMissingCovers } from "../../src/server/metadata/cover-utility.ts";
import { libraryData } from "../../src/server/services/library.ts";

const storyId = "44444444-4444-4444-8444-444444444444";
const twinA = "55555555-5555-4555-8555-555555555555";
const twinB = "66666666-6666-4666-8666-666666666666";
const manga = (id: string, title: string, authors: string[] = []) => ({
  id,
  attributes: { title: { en: title }, altTitles: [] },
  relationships: authors.map((name) => ({
    type: "author",
    attributes: { name },
  })),
});
const cover = (id: string, volume: string, locale: string) => ({
  id,
  attributes: { volume, locale, fileName: `${id}.jpg` },
});
export function memoryBucket() {
  const objects = new Map<string, unknown>();
  const bucket = {
    head: async (key: string) => (objects.has(key) ? { key } : null),
    put: async (key: string, value: unknown) => {
      objects.set(key, value);
      return { key };
    },
  } as unknown as R2Bucket;
  return { objects, bucket };
}
const olEdition = (
  key: string,
  title: string,
  cover: number,
  publisher: string,
  language = "eng",
) => ({
  key: `/works/${key}W`,
  editions: {
    docs: [
      {
        key: `/books/${key}`,
        title,
        cover_i: cover,
        publisher: [publisher],
        language: [language],
      },
    ],
  },
});
export const mangaDex: typeof fetch = async (input) => {
  const url = String(input);
  if (
    url.startsWith("https://uploads.mangadex.org/") ||
    url.startsWith("https://covers.openlibrary.org/")
  )
    return new Response(
      new Uint8Array([255, 216, 255, ...new TextEncoder().encode(url)]),
      { headers: { "Content-Type": "image/jpeg" } },
    );
  if (url.includes("/manga?") && url.includes("title=Story"))
    return Response.json({
      data: [
        manga(storyId, "Story", ["Ooima Yoshitoki"]),
        manga("77777777-7777-4777-8777-777777777777", "Story Extra"),
      ],
    });
  if (url.includes("/manga?") && url.includes("title=Twin"))
    return Response.json({
      data: [manga(twinA, "Twin"), manga(twinB, "Twin")],
    });
  if (url.includes("/manga?")) return Response.json({ data: [] });
  if (url.includes(`/cover?manga[]=${storyId}`))
    return Response.json({
      data: [
        cover("c-en-1", "1", "en"),
        cover("c-ja-1", "1", "ja"),
        cover("c-ja-2", "2", "ja"),
      ],
      total: 3,
    });
  // Open Library edition search: only Story has an English volume 2 edition;
  // a hardcover, an other-publisher printing and a box set must rank lower or
  // be rejected.
  if (url.startsWith("https://openlibrary.org/search.json"))
    return Response.json({
      docs: url.includes("Story")
        ? [
            olEdition("OL0M", "Story, Vol. 2", 900, "Independently Published"),
            olEdition("OL1M", "Story: Box Set 1-3", 901, "Publisher"),
            olEdition("OL2M", "Story, Vol. 2 (Hardcover)", 902, "Publisher"),
            olEdition("OL3M", "Story, Vol. 2", 903, "Other House"),
            olEdition("OL4M", "Story, Vol. 2", 904, "Publisher LLC"),
            olEdition("OL5M", "Story Vol. 2", 905, "Publisher", "fre"),
          ]
        : [],
    });
  return new Response("unexpected", { status: 500 });
};

export async function seedCovers(db: Store) {
  const story = {
    kind: "manga",
    title: "Story",
    authors: ["Yoshitoki Ōima"],
    publisher: "Publisher",
  };
  const en1 = await saveItem(db, { ...story, volume: "1", language: "EN" });
  const en2 = await saveItem(db, { ...story, volume: "2", language: "EN" });
  const jp1 = await saveItem(db, { ...story, volume: "1", language: "JP" });
  const collectors = await saveItem(db, {
    ...story,
    volume: "1",
    format: "collectors",
    editionTitle: "Story: Collector's Edition",
  });
  const manual = await saveItem(db, {
    ...story,
    volume: "3",
    artwork: {
      url: "https://example.com/owner.jpg",
      scope: "edition",
      attribution: "Owner-selected artwork",
    },
  });
  await saveItem(db, { kind: "manga", title: "Twin", volume: "1" });
  await saveItem(db, { kind: "manga", title: "Unlisted", volume: "1" });
  await saveItem(db, { kind: "cd", title: "Album", artists: ["Band"] });
  return { en1, en2, jp1, collectors, manual };
}

/** Distinct R2 objects referenced by cover variants and present in the bucket. */
async function storedObjects(db: Store, bucket: R2Bucket) {
  let stored = 0;
  for (const row of await db.all(
    "SELECT DISTINCT object_key FROM cover_variants WHERE object_key IS NOT NULL",
  ))
    if (await bucket.head(String(row.object_key))) stored++;
  return stored;
}

// Shared by SQLite integration and real workerd D1/R2 tests.
export async function coverScenario(db: Store, bucket: R2Bucket) {
  const ids = await seedCovers(db);
  const versions = new Map(
    await Promise.all(
      Object.values(ids).map(
        async ({ id }) => [id, (await getItem(db, id)).version] as const,
      ),
    ),
  );

  const preview = await cacheMissingCovers(db, {
    bucket,
    fetcher: mangaDex,
    dryRun: true,
  });
  assert.equal(preview.totals.matched, 3);
  assert.equal(
    (await db.all("SELECT COUNT(*) AS n FROM external_refs"))[0]?.n,
    0,
  );
  assert.equal(
    (await db.all("SELECT COUNT(*) AS n FROM cover_assets"))[0]?.n,
    1,
  );

  let calls = 0;
  const counted: typeof fetch = (input, init) => {
    calls++;
    return mangaDex(input, init);
  };
  const report = await cacheMissingCovers(db, { bucket, fetcher: counted });
  const outcome = (title: string, volume?: string, language?: string) =>
    report.outcomes.filter(
      (o) =>
        o.title === title &&
        (volume === undefined || o.volume === volume) &&
        (language === undefined || o.language === language),
    );
  assert.equal(outcome("Story", "1", "EN")[0]?.outcome, "matched");
  assert.equal(outcome("Story", "1", "JP")[0]?.outcome, "matched");
  assert.equal(outcome("Story", "2", "EN")[0]?.outcome, "matched");
  assert.match(outcome("Story", "2", "EN")[0]!.reason, /Open Library/);
  assert.match(outcome("Twin")[0]!.reason, /2 MangaDex titles/);
  assert.equal(outcome("Unlisted")[0]?.outcome, "unmatched");
  assert.equal(outcome("Album")[0]?.outcome, "needs-selection");
  assert.deepEqual(
    { ...report.totals },
    {
      matched: 3,
      cached: 3,
      "already-cached": 0,
      unmatched: 2,
      failed: 0,
      deferred: 0,
      "needs-selection": 1,
    },
  );
  assert.equal(await storedObjects(db, bucket), 3);

  // Applied art is distinguishable from owner selections, and copies sharing
  // an updated edition get a new version so stale editor forms are rejected.
  const en1 = await getItem(db, ids.en1.id);
  assert.equal(en1.item.artwork?.scope, "edition");
  assert.equal(en1.item.artwork?.language, "EN");
  assert.match(en1.item.artwork!.attribution, /automatic/);
  assert.equal(en1.version, versions.get(ids.en1.id)! + 1);
  // Publisher-matching paperback edition wins; its cover is cached in R2 too.
  const en2 = (await getItem(db, ids.en2.id)).item.artwork;
  assert.equal(
    en2?.url,
    "https://covers.openlibrary.org/b/id/904-L.jpg?default=false",
  );
  assert.equal(en2?.scope, "edition");
  assert.match(en2!.attribution, /publisher\); confirm/);
  assert.equal((await getItem(db, ids.collectors.id)).item.artwork, null);
  assert.equal(
    (await getItem(db, ids.manual.id)).item.artwork?.url,
    "https://example.com/owner.jpg",
  );
  assert.equal(
    (await getItem(db, ids.manual.id)).version,
    versions.get(ids.manual.id),
  );
  assert.deepEqual(
    (
      await db.all(
        "SELECT provider,is_owner_selected,storage_mode FROM cover_assets ORDER BY is_owner_selected,provider",
      )
    ).map((row) => ({ ...row })),
    [
      { provider: "mangadex", is_owner_selected: 0, storage_mode: "r2" },
      { provider: "mangadex", is_owner_selected: 0, storage_mode: "r2" },
      { provider: "openlibrary", is_owner_selected: 0, storage_mode: "r2" },
      { provider: "manual", is_owner_selected: 1, storage_mode: "external" },
    ],
  );
  assert.deepEqual(
    (
      await db.all(
        "SELECT external_id,match_basis,is_owner_confirmed FROM external_refs",
      )
    ).map((row) => ({ ...row })),
    [
      {
        external_id: storyId,
        match_basis: "automatic-exact-title",
        is_owner_confirmed: 0,
      },
    ],
  );
  const story = (await libraryData((sql) => db.all(sql))).entries.find(
    (entry) => entry.kind === "manga" && entry.title === "Story",
  );
  assert.ok(
    story?.kind === "manga" &&
      story.copies.some((copy) =>
        copy.artwork?.url.startsWith("/api/artwork/"),
      ),
  );

  // A rerun reuses D1 checkpoints and cached provider responses.
  const before = calls;
  const repeat = await cacheMissingCovers(db, { bucket, fetcher: counted });
  assert.equal(calls, before);
  assert.equal(repeat.totals.matched, 0);
  assert.equal(repeat.totals["already-cached"], 3);
  assert.equal(repeat.totals.unmatched, 2);
  assert.equal(await storedObjects(db, bucket), 3);

  // An owner re-save of the copy keeps the same cached asset identity.
  const current = await getItem(db, ids.en1.id);
  await saveItem(db, current.item, {
    id: ids.en1.id,
    version: current.version,
  });
  assert.deepEqual(
    (
      await db.all(
        "SELECT storage_mode,COUNT(*) AS n FROM cover_assets GROUP BY storage_mode ORDER BY storage_mode",
      )
    ).map((row) => ({ ...row })),
    [
      { storage_mode: "external", n: 1 },
      { storage_mode: "r2", n: 3 },
    ],
  );
}
