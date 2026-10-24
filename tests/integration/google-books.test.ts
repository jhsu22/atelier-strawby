import test from "node:test";
import assert from "node:assert/strict";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { lookupMetadata } from "../../src/server/metadata/providers.ts";
import { boundedFetch } from "../../src/server/metadata/http.ts";

const key = "synthetic-test-key-never-a-real-credential";
const record = (id: string, info: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, volumeInfo: {title: "A Story, Vol. 2", language: "en", authors: ["A Writer"], publisher: "Kodansha", ...info}, ...extra });

test("Google Books requires a server key; exact language and numbered titles match, credits/publishers are reviewed, acquisition fields never patched", async () => {
  const db = openSqlite(":memory:");
  let calls = 0;
  const fetcher: typeof fetch = async (address, init) => {
    calls++;
    const url = new URL(String(address));
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(url.searchParams.has("key"), false);
    assert.ok(!url.href.includes(key));
    assert.equal(new Headers(init?.headers).get("X-Goog-Api-Key"), key);
    assert.equal(url.searchParams.get("langRestrict"), "en");
    return Response.json({items: [
      record("right", {subtitle: "", imageLinks: {thumbnail: "http://books.google.com/books/content?id=right&printsec=frontcover"}, industryIdentifiers: [{type: "ISBN_13", identifier: "9781234567890"}]}),
      record("ebook", {}, {saleInfo: {isEbook: true}}),
      record("jp", {language: "ja"}),
      record("missing-language", {language: undefined}),
      record("wrong-volume", {title: "A Story, Vol. 3"}),
      record("novel", {title: "A Story (light novel), Vol. 2"}),
      record("other-author", {authors: ["Different Person"]}),
      record("different-publisher", {publisher: "Other House"}),
    ]});
  };
  try {
    await migrateSqlite(db);
    const input = {kind: "manga", query: "A Story", volume: "2", artist: "A Writer", publisher: "Kodansha", provider: "googlebooks"};
    const disabled = await lookupMetadata(db, input, {fetcher});
    assert.equal(calls, 0);
    assert.match(disabled.warnings[0]!, /GOOGLE_BOOKS_API_KEY/);
    const result = await lookupMetadata(db, input, {fetcher, googleBooksKey: key});
    assert.deepEqual(result.candidates.filter(value => value.applicable).map(value => value.id), ["right", "ebook", "different-publisher"]);
    assert.equal(result.candidates.length, 8, "provider result order and context are retained");
    assert.equal(result.candidates[2]!.id, "jp");
    assert.equal(result.candidates[2]!.applicable, false);
    const candidate = result.candidates[0]!;
    assert.equal(candidate.provider, "googlebooks");
    assert.equal(candidate.patch.artwork?.scope, "representative");
    assert.match(candidate.patch.artwork!.url, /^https:\/\/books.google.com/);
    assert.equal(candidate.sourceUrl, "https://books.google.com/books?id=right");
    assert.equal(candidate.patch.acquiredOn, undefined);
    assert.equal(candidate.patch.volume, undefined);
    assert.equal(candidate.patch.title, undefined);
    assert.equal(candidate.patch.language, undefined);
    assert.equal(candidate.patch.format, undefined);
    assert.match(result.candidates.find(value => value.id === "ebook")!.warning, /eBook/);
    assert.match(result.candidates.at(-1)!.warning, /Publisher differs/);
    const before = calls;
    await lookupMetadata(db, input, {fetcher, googleBooksKey: key});
    assert.equal(calls, before, "successful lookups use the existing D1 cache");
    const rows = await db.all("SELECT * FROM metadata_cache");
    assert.ok(!JSON.stringify(rows).includes(key));
  } finally { await db.close(); }
});

test("Google Books accepts ISBN lookup and standalone books, handles absent images, rejects derivatives and unsafe cover URLs", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const fetcher: typeof fetch = async () => Response.json({items: [
      record("book", {title: "Project Hail Mary", authors: ["Andy Weir"], publisher: "Ballantine Books", imageLinks: {thumbnail: "https://attacker.example/image.jpg"}}),
      record("guide", {title: "Project Hail Mary Study Guide", authors: ["Andy Weir"]}),
    ]});
    const result = await lookupMetadata(db, {kind: "manga", medium: "book", query: "Project Hail Mary", provider: "googlebooks"}, {fetcher, googleBooksKey: key});
    assert.deepEqual(result.candidates.filter(value => value.applicable).map(value => value.id), ["book"]);
    assert.equal(result.candidates[0]!.patch.artwork, undefined);
    assert.deepEqual(result.candidates[0]!.patch.authors, ["Andy Weir"]);
    const isbn = await lookupMetadata(db, {kind: "manga", medium: "book", query: "978-0-593-13520-4", provider: "googlebooks"}, {googleBooksKey: key, fetcher: async address => {
      assert.equal(new URL(String(address)).searchParams.get("q"), "isbn:9780593135204");
      return Response.json({items: [record("isbn", {title: "An ISBN match", industryIdentifiers: [{type: "ISBN_13", identifier: "9780593135204"}]})]});
    }});
    assert.equal(isbn.candidates[0]!.id, "isbn");
    assert.equal(isbn.candidates[0]!.applicable, true);
  } finally { await db.close(); }
});

test("Google Books access and quota failures are actionable and never echo provider credentials", async () => {
  for (const [reason, expected] of [["keyInvalid", /rejected access/], ["dailyLimitExceeded", /quota is exhausted/]] as const) {
    const db = openSqlite(":memory:");
    try {
      await migrateSqlite(db);
      const result = await lookupMetadata(db, {kind: "manga", query: "Story", provider: "googlebooks"}, {googleBooksKey: key, fetcher: async () => Response.json({error: {message: `Never echo ${key}`, errors: [{reason}]}}, {status: 403})});
      assert.match(result.warnings[0]!, expected);
      assert.equal(JSON.stringify(result).includes(key), false);
      assert.equal(result.candidates.length, 0);
      assert.equal(JSON.stringify(await db.all("SELECT * FROM metadata_cache")).includes(key), false);
    } finally { await db.close(); }
  }
  await assert.rejects(boundedFetch("https://www.googleapis.com/books/v1/volumes?q=test", {headers: {"X-Goog-Api-Key": key}}, 1000,
    async address => {
      assert.equal(new URL(String(address)).hostname, "www.googleapis.com");
      return new Response(null, {status: 302, headers: {location: "https://openlibrary.org/leak"}});
    }), /unexpected redirect/);
});

test("Google Books precedes Open Library in automatic fallback, while missing keys skip it", async () => {
  const db = openSqlite(":memory:");
  let googleCalls = 0;
  const fetcher: typeof fetch = async address => {
    if (new URL(String(address)).hostname === "www.googleapis.com") {
      googleCalls++;
      return Response.json({items: [record("fallback", {})]});
    }
    return Response.json(String(address).includes("openlibrary") ? {docs: []} : {data: []});
  };
  try {
    await migrateSqlite(db);
    const input = {kind: "manga", query: "A Story", volume: "2"};
    await lookupMetadata(db, input, {fetcher});
    assert.equal(googleCalls, 0);
    const result = await lookupMetadata(db, input, {fetcher, googleBooksKey: key});
    assert.equal(result.candidates[0]!.provider, "googlebooks");
    assert.equal(googleCalls, 1);
    await lookupMetadata(db, input, {googleBooksKey: key, fetcher: async () => {throw new Error("cache should be used");}});
    assert.equal(googleCalls, 1);
  } finally { await db.close(); }
});

test("automatic metadata uses Google before Open Library for manga, books and light novels, and falls through incompatible Google results", async () => {
  for (const medium of ["manga", "book", "light_novel"] as const) {
    const db = openSqlite(":memory:");
    const requested: string[] = [];
    try {
      await migrateSqlite(db);
      const result = await lookupMetadata(db, {kind: "manga", medium, query: "A Story", volume: "2"}, {googleBooksKey: key, fetcher: async address => {
        const host = new URL(String(address)).hostname; requested.push(host);
        if (host === "api.mangadex.org") return Response.json({data: []});
        if (host === "openlibrary.org") throw new Error("Open Library must not run before a successful Google match");
        return Response.json({items: [record("preferred", {title: medium === "book" ? "A Story" : medium === "light_novel" ? "A Story (light novel) Vol. 2" : "A Story Vol. 2"})]});
      }});
      assert.equal(result.candidates[0]!.provider, "googlebooks");
      assert.ok(!requested.includes("openlibrary.org"), medium);
    } finally { await db.close(); }
  }
  const db = openSqlite(":memory:");
  const requested: string[] = [];
  try {
    await migrateSqlite(db);
    const result = await lookupMetadata(db, {kind: "manga", query: "A Story", volume: "2"}, {googleBooksKey: key, fetcher: async address => {
      const host = new URL(String(address)).hostname; requested.push(host);
      if (host === "api.mangadex.org") return Response.json({data: []});
      if (host === "www.googleapis.com") return Response.json({items: [record("wrong-number", {title: "A Story Vol. 99"})]});
      return Response.json({docs: [{key: "/works/OL123W", title: "A Story", author_name: ["A Writer"]}]});
    }});
    assert.equal(result.candidates[0]!.provider, "openlibrary");
    assert.ok(requested.indexOf("www.googleapis.com") < requested.indexOf("openlibrary.org"));
  } finally { await db.close(); }
});
