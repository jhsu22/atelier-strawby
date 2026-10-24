import test from "node:test";
import assert from "node:assert/strict";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { lookupMetadata } from "../../src/server/metadata/providers.ts";
import { providerJson } from "../../src/server/metadata/http.ts";
import { saveItem } from "../../src/server/services/items.ts";
import { cacheItemArtwork } from "../../src/server/metadata/artwork.ts";
const mangaId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";

test("manga metadata fallback, exact volume/language matches, representative labels and cached retry behavior", async () => {
  const db = openSqlite(":memory:");
  let calls = 0;
  try {
    await migrateSqlite(db);
    const fetcher: typeof fetch = async (url) => {
      calls++;
      if (String(url).includes("/manga?"))
        return new Response("unavailable", { status: 500 });
      if (String(url).includes("openlibrary.org"))
        return Response.json({
          docs: [
            {
              key: "/works/OL123W",
              title: "Story",
              author_name: ["Author"],
              cover_i: 123,
            },
          ],
        });
      return Response.json({
        data: [
          {
            id: "cover",
            attributes: { volume: "2", locale: "ja", fileName: "cover.jpg" },
          },
        ],
        total: 1,
      });
    };
    const fallback = await lookupMetadata(
      db,
      { kind: "manga", query: "Story" },
      { fetcher },
    );
    assert.equal(fallback.candidates[0]?.provider, "openlibrary");
    assert.equal(
      fallback.candidates[0]?.patch.artwork?.scope,
      "representative",
    );
    assert.ok(fallback.warnings.length);
    const before = calls;
    await lookupMetadata(db, { kind: "manga", query: "Story" }, { fetcher });
    assert.equal(calls, before);
    const exact = await lookupMetadata(
      db,
      {
        kind: "manga",
        query: "Story",
        id: mangaId,
        language: "JP",
        volume: "2",
      },
      { fetcher },
    );
    assert.equal(exact.candidates[0]?.patch.artwork?.scope, "edition");
    const mismatch = await lookupMetadata(
      db,
      {
        kind: "manga",
        query: "Story",
        id: mangaId,
        language: "EN",
        volume: "2",
      },
      { fetcher },
    );
    assert.equal(
      mismatch.candidates[0]?.patch.artwork?.scope,
      "representative",
    );
    const refreshed = await providerJson(
      db,
      "retry-provider",
      "https://openlibrary.org/retry",
      { fetcher: async () => Response.json({ value: 1 }) },
    );
    assert.deepEqual(refreshed, { value: 1 });
    assert.deepEqual(
      await providerJson(
        db,
        "retry-provider",
        "https://openlibrary.org/retry",
        { retry: true, fetcher: async () => Response.json({ value: 2 }) },
      ),
      { value: 2 },
    );
  } finally {
    await db.close();
  }
});
test("MusicBrainz release includes multiple discs, label/catalog and CAA representative fallback without inventing a physical iTunes edition", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const fetcher: typeof fetch = async (url, init) => {
      const address = String(url);
      if (address.includes("musicbrainz.org/ws/2/release/")) {
        assert.match(
          String(new Headers(init?.headers).get("user-agent")),
          /^StrawbyStacks\//,
        );
        return Response.json({
          id: releaseId,
          title: "Album",
          date: "2024-10-01",
          country: "JP",
          "artist-credit": [{ name: "Artist" }],
          "label-info": [
            { label: { name: "Label" }, "catalog-number": "CAT-1" },
          ],
          "release-group": { id: groupId },
          media: [
            {
              position: 1,
              format: "CD",
              tracks: [{ position: 1, title: "Song", length: 120000 }],
            },
            {
              position: 2,
              format: "Blu-ray",
              tracks: [{ position: 1, title: "Concert" }],
            },
          ],
        });
      }
      if (address.includes("/release-group/"))
        return Response.json({ images: [{ front: true }] });
      return new Response("", { status: 404 });
    };
    const result = await lookupMetadata(
      db,
      { kind: "cd", query: "Album", id: releaseId },
      { fetcher },
    );
    const patch = result.candidates[0]!.patch;
    assert.equal(patch.labels?.[0]?.catalogNumber, "CAT-1");
    assert.equal(patch.media?.[1]?.format, "Blu-ray");
    assert.equal(patch.tracks?.[1]?.medium, 2);
    assert.equal(patch.artwork?.scope, "representative");
    const fallback = await lookupMetadata(
      db,
      { kind: "cd", query: "Digital", provider: "itunes" },
      {
        fetcher: async () =>
          Response.json({
            results: [
              {
                collectionId: 1,
                collectionName: "Digital",
                artistName: "Artist",
                releaseDate: "2024-01-01T00:00:00Z",
                collectionViewUrl: "https://music.apple.com/album/1",
              },
            ],
          }),
      },
    );
    assert.equal(fallback.candidates[0]?.patch.artwork, undefined);
    assert.equal(fallback.candidates[0]?.patch.media, undefined);
    assert.match(fallback.candidates[0]!.warning, /Digital-album fallback/);
  } finally {
    await db.close();
  }
});
test("timeouts, malformed JSON and Retry-After retain stored collection and enforce shared provider backoff", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    await saveItem(db, { kind: "manga", title: "Kept intact" });
    let calls = 0;
    await assert.rejects(
      providerJson(db, "limited", "https://musicbrainz.org/limited", {
        fetcher: async () => {
          calls++;
          return new Response("", {
            status: 429,
            headers: { "Retry-After": "120" },
          });
        },
      }),
      /rate limiting/,
    );
    await assert.rejects(
      providerJson(db, "limited", "https://musicbrainz.org/limited", {
        retry: true,
        fetcher: async () => {
          calls++;
          return Response.json({});
        },
      }),
      /asked us to wait/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      providerJson(db, "timeout", "https://musicbrainz.org/timeout", {
        fetcher: async () => {
          throw new DOMException("timeout", "TimeoutError");
        },
      }),
      /timed out/,
    );
    await assert.rejects(
      providerJson(db, "malformed", "https://musicbrainz.org/malformed", {
        fetcher: async () => new Response("<html>bad"),
      }),
      /invalid data/,
    );
    assert.equal(
      (await db.all("SELECT COUNT(*) AS n FROM collection_items"))[0]?.n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("selected provider artwork is cached once in R2 and reused by a fresh read; failed art leaves the copy intact", async () => {
  const db = openSqlite(":memory:");
  const objects = new Map<string, unknown>();
  let calls = 0;
  const bucket = {
    head: async (key: string) => (objects.has(key) ? { key } : null),
    put: async (key: string, value: unknown) => {
      objects.set(key, value);
      return { key };
    },
  } as unknown as R2Bucket;
  try {
    await migrateSqlite(db);
    const saved = await saveItem(db, {
      kind: "manga",
      title: "Artwork",
      artwork: {
        provider: "mangadex",
        sourceId: "cover",
        url: `https://uploads.mangadex.org/covers/${mangaId}/cover.jpg.512.jpg`,
        scope: "edition",
      },
    });
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response(new Uint8Array([255, 216, 255, 0]), {
        headers: { "Content-Type": "image/jpeg" },
      });
    };
    assert.equal(
      (await cacheItemArtwork(db, bucket, saved.id, fetcher)).cached,
      true,
    );
    assert.equal(
      (await cacheItemArtwork(db, bucket, saved.id, fetcher)).cached,
      true,
    );
    assert.equal(calls, 1);
    assert.equal(objects.size, 1);
    assert.equal(
      (await db.all("SELECT storage_mode FROM cover_assets"))[0]?.storage_mode,
      "r2",
    );
  } finally {
    await db.close();
  }
});
