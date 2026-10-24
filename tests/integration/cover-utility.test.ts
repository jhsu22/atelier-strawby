import test from "node:test";
import assert from "node:assert/strict";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { getItem, saveItem } from "../../src/server/services/items.ts";
import { cacheMissingCovers } from "../../src/server/metadata/cover-utility.ts";
import {
  coverScenario,
  mangaDex,
  memoryBucket,
  seedCovers,
} from "../helpers/cover-scenario.ts";

test("cover utility applies only unambiguous MangaDex volume/language art, caches it in R2 and resumes without repeating work", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await coverScenario(db, memoryBucket().bucket);
  } finally {
    await db.close();
  }
});

test("cover utility defers on provider rate limits, keeps the collection unchanged and resumes on rerun", async () => {
  const db = openSqlite(":memory:");
  const { objects, bucket } = memoryBucket();
  try {
    await migrateSqlite(db);
    const ids = await seedCovers(db);
    const limited = await cacheMissingCovers(db, {
      bucket,
      fetcher: async () =>
        new Response("", { status: 429, headers: { "Retry-After": "120" } }),
    });
    assert.equal(limited.totals.matched, 0);
    assert.equal(limited.totals.deferred, 3);
    assert.equal(
      (await db.all("SELECT COUNT(*) AS n FROM external_refs"))[0]?.n,
      0,
    );
    assert.equal((await getItem(db, ids.en1.id)).item.artwork, null);
    // Simulate the Retry-After window passing; --retry bypasses cached failures.
    await db.batch([
      { sql: "UPDATE provider_state SET blocked_until=NULL", params: [] },
    ]);
    const resumed = await cacheMissingCovers(db, {
      bucket,
      fetcher: mangaDex,
      retry: true,
      seriesLimit: 1,
    });
    assert.equal(resumed.totals.matched, 3);
    assert.equal(resumed.totals.deferred, 2);
    assert.match(
      resumed.outcomes.find((o) => o.outcome === "deferred")!.reason,
      /limit/,
    );
    assert.equal(objects.size, 3);
    assert.equal((await getItem(db, ids.jp1.id)).item.artwork?.language, "JP");
    // Cached series do not consume the limit, so limited reruns progress.
    const next = await cacheMissingCovers(db, {
      bucket,
      fetcher: mangaDex,
      seriesLimit: 1,
    });
    assert.equal(
      next.outcomes.find((o) => o.title === "Twin")?.outcome,
      "unmatched",
    );
    assert.equal(
      next.outcomes.find((o) => o.title === "Unlisted")?.outcome,
      "deferred",
    );
  } finally {
    await db.close();
  }
});

test("cover utility sends light novels and books to Open Library editions only, never MangaDex", async () => {
  const db = openSqlite(":memory:");
  const { bucket } = memoryBucket();
  const requested: string[] = [];
  const edition = (
    key: string,
    title: string,
    cover: number,
    publisher: string,
    author = "",
  ) => ({
    key: `/works/${key}W`,
    title,
    author_name: author ? [author] : [],
    editions: {
      docs: [
        {
          key: `/books/${key}`,
          title,
          cover_i: cover,
          publisher: [publisher],
          language: ["eng"],
        },
      ],
    },
  });
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith("https://covers.openlibrary.org/"))
      return new Response(
        new Uint8Array([255, 216, 255, ...new TextEncoder().encode(url)]),
        {
          headers: { "Content-Type": "image/jpeg" },
        },
      );
    if (url.includes("Novel+Series") || url.includes("Novel%20Series"))
      return Response.json({
        docs: [
          // Same title from the house that also prints the manga: no evidence.
          edition("OL0M", "Novel Series, Vol. 2", 800, "Yen Press"),
          edition("OL1M", "Novel Series, Vol. 2 (manga)", 801, "Yen Press"),
          edition("OL2M", "Novel Series, Vol. 2 (light novel)", 802, "Yen On"),
        ],
      });
    if (url.includes("Project"))
      return Response.json({
        docs: [
          edition(
            "OL3M",
            "Project Hail Mary Study Guide",
            803,
            "Ballantine Books",
            "Someone Else",
          ),
          edition(
            "OL4M",
            "Project Hail Mary",
            804,
            "Ballantine Books",
            "Andy Weir",
          ),
        ],
      });
    return Response.json({ docs: [], data: [] });
  };
  try {
    await migrateSqlite(db);
    const lightNovel = await saveItem(db, {
      kind: "manga",
      medium: "light_novel",
      title: "Novel Series",
      volume: "2",
      publisher: "Yen Press",
    });
    const book = await saveItem(db, {
      kind: "manga",
      medium: "book",
      title: "Project Hail Mary",
      authors: ["Andy Weir"],
      publisher: "Ballantine Books",
    });
    const report = await cacheMissingCovers(db, { bucket, fetcher });
    assert.equal(report.totals.matched, 2);
    assert.equal(requested.filter((url) => url.includes("mangadex")).length, 0);
    assert.equal(
      (await getItem(db, lightNovel.id)).item.artwork?.url,
      "https://covers.openlibrary.org/b/id/802-L.jpg?default=false",
    );
    const bookArt = (await getItem(db, book.id)).item.artwork;
    assert.equal(
      bookArt?.url,
      "https://covers.openlibrary.org/b/id/804-L.jpg?default=false",
    );
    assert.match(bookArt!.attribution, /title, author, language, publisher/);
  } finally {
    await db.close();
  }
});
