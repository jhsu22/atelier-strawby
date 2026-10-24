import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { lookupIsbn } from "../../src/server/scan/lookup.ts";
import { draftFromScan, preselectedMatch } from "../../src/domain/scan.ts";
import type { ScanLookupResult } from "../../src/domain/scan.ts";
import { itemSchema } from "../../src/domain/item.ts";
import { saveItem, getItem } from "../../src/server/services/items.ts";
import { exportCsv } from "../../src/server/services/transfer.ts";
import { exportBackup, restoreBackup } from "../../src/server/services/backup.ts";
import { enforceRateLimits, SCAN_LIMITS } from "../../src/server/http/rate-limit.ts";
import { ApiError } from "../../src/server/http/api.ts";
import { revision } from "../../src/server/db/store.ts";
import { isbnCases, replayFetcher, seededCollection } from "../helpers/scan-fixtures.ts";

const key = "synthetic-test-key-never-a-real-credential";
const draftFor = (result: ScanLookupResult) =>
  draftFromScan(result, result.editions.find((edition) => edition.isbnVerified) ?? null, preselectedMatch(result));

test("measured ISBN lookup accuracy on the recorded test set, with zero unsafe outcomes", async () => {
  const { cases } = await isbnCases();
  const db = await seededCollection();
  const rows: Record<string, unknown>[] = [];
  try {
    const fetcher = await replayFetcher();
    for (const entry of cases) {
      const result = await lookupIsbn(db, { code: entry.code ?? entry.isbn, source: "manual" }, { fetcher, googleBooksKey: key });
      const draft = draftFor(result);
      const preselected = preselectedMatch(result);
      rows.push({
        isbn: entry.isbn,
        label: entry.label,
        tags: entry.tags,
        catalogFound: result.editions.some((edition) => edition.isbnVerified),
        providers: [...new Set(result.editions.filter((edition) => edition.isbnVerified).map((edition) => edition.provider))],
        expectedSeries: entry.expect.series,
        preselectedSeries: preselected?.seriesTitle ?? null,
        offeredSeries: result.matches.map((match) => match.seriesTitle),
        seriesCorrect: (preselected?.seriesTitle ?? null) === entry.expect.series,
        seriesOffered: entry.expect.series === null || result.matches.some((match) => match.seriesTitle === entry.expect.series),
        wrongSeriesPreselected: Boolean(preselected && preselected.seriesTitle !== entry.expect.series),
        expectedVolume: entry.expect.volume,
        volume: draft.item.volume || null,
        volumeCorrect: (draft.item.volume || null) === entry.expect.volume,
        language: draft.item.language,
        languageCorrect: draft.item.language === entry.expect.language,
        expectedDuplicate: entry.expect.duplicate,
        duplicate: result.duplicate.level,
        duplicateCorrect: result.duplicate.level === entry.expect.duplicate,
        falseDuplicate: result.duplicate.level !== "none" && entry.expect.duplicate === "none",
        isbnKept: draft.item.isbn13 === entry.isbn,
        flags: draft.flags,
        expectedFlag: entry.expect.flag ?? null,
        flagShown: entry.expect.flag ? [...draft.flags, ...result.warnings].some((flag) => flag.toLowerCase().includes(entry.expect.flag!.toLowerCase())) : null,
      });
    }
  } finally {
    await db.close();
  }
  const count = (field: string, subset = rows) => subset.filter((row) => row[field] === true).length;
  const owned = rows.filter((row) => row.expectedDuplicate !== "none");
  const withCatalog = rows.filter((row) => row.catalogFound);
  const summary = {
    measuredAt: new Date().toISOString(),
    method: "Recorded live Google Books, Open Library and MangaDex responses (tests/fixtures/scan/recorded-responses.json) replayed against the owner's seeded 177-copy collection. Each case is one exact ISBN lookup; barcode decoding is measured separately.",
    cases: rows.length,
    catalogFound: count("catalogFound"),
    seriesCorrect: count("seriesCorrect"),
    seriesCorrectWhenCatalogFound: `${count("seriesCorrect", withCatalog)}/${withCatalog.length}`,
    seriesOfferedWhenCatalogFound: `${count("seriesOffered", withCatalog)}/${withCatalog.length}`,
    wrongSeriesPreselected: count("wrongSeriesPreselected"),
    volumeCorrect: count("volumeCorrect"),
    volumeCorrectWhenCatalogFound: `${count("volumeCorrect", withCatalog)}/${withCatalog.length}`,
    languageCorrect: count("languageCorrect"),
    duplicateCorrect: count("duplicateCorrect"),
    duplicatesDetected: `${owned.filter((row) => row.duplicate === row.expectedDuplicate).length}/${owned.length}`,
    falseDuplicates: count("falseDuplicate"),
    isbnKept: count("isbnKept"),
    flagsShown: `${count("flagShown")}/${rows.filter((row) => row.expectedFlag).length}`,
  };
  await mkdir("data/generated", { recursive: true });
  await writeFile("data/generated/scan-isbn-accuracy.json", `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  // Safety invariants hold for every case: no invented ISBN, no wrong
  // preselected series and no false duplicate warning.
  assert.equal(summary.isbnKept, rows.length);
  assert.equal(summary.wrongSeriesPreselected, 0, JSON.stringify(rows.filter((row) => row.wrongSeriesPreselected)));
  assert.equal(summary.falseDuplicates, 0, JSON.stringify(rows.filter((row) => row.falseDuplicate)));
  // Regression floors at the measured values (2026-10-24 recording).
  assert.ok(summary.catalogFound >= 14, `catalog coverage fell to ${summary.catalogFound}`);
  assert.ok(count("seriesCorrect", withCatalog) === withCatalog.length, "every case with a catalog record resolves its series correctly");
  assert.ok(count("volumeCorrect", withCatalog) === withCatalog.length, "every case with a catalog record resolves its volume");
  assert.equal(summary.languageCorrect, rows.length);
});

test("invalid barcodes are refused before any database or provider work", async () => {
  const { invalid } = await isbnCases();
  const db = openSqlite(":memory:");
  const calls: string[] = [];
  try {
    await migrateSqlite(db);
    for (const entry of invalid) {
      await assert.rejects(
        lookupIsbn(db, { code: entry.code, source: "camera" }, { fetcher: await replayFetcher({ calls }) }),
        (error: unknown) => error instanceof ApiError && error.status === 422 && error.message.length > 20,
        entry.label,
      );
    }
    assert.equal(calls.length, 0);
    await assert.rejects(lookupIsbn(db, { code: "9781974715466", source: "camera", image: "data:," }), /Unrecognized key/);
  } finally {
    await db.close();
  }
});

test("collection first: a saved ISBN answers repeat scans with no provider request; D1 caches the rest", async () => {
  const db = await seededCollection();
  try {
    const calls: string[] = [];
    const fetcher = await replayFetcher({ calls });
    const first = await lookupIsbn(db, { code: "9781974709939", source: "camera" }, { fetcher, googleBooksKey: key });
    assert.ok(calls.length >= 2, "first scan queries the catalogs");
    assert.equal(first.duplicate.level, "same-volume");
    const draft = draftFor(first);
    const before = (await db.all("SELECT COUNT(*) AS n FROM edition_runs"))[0]!.n;
    const saved = await saveItem(db, { ...draft.item, catalogSource: { provider: first.editions[0]!.provider, sourceId: first.editions[0]!.sourceId, sourceUrl: first.editions[0]!.sourceUrl }, acquiredOn: "2026-10-24" }, { requestId: crypto.randomUUID() });
    assert.equal((await db.all("SELECT COUNT(*) AS n FROM edition_runs"))[0]!.n, before, "the owned run is reused, not split");
    const copies = await db.all("SELECT v.item_id FROM volumes v JOIN volume_editions e ON e.id=v.volume_edition_id WHERE e.isbn13='9781974709939'");
    assert.equal(copies.length, 2, "the intentional duplicate is kept beside the original copy");
    const refs = await db.all("SELECT provider,match_basis,is_owner_confirmed FROM external_refs");
    assert.deepEqual(refs.map((row) => ({ ...row })), [{ provider: first.editions[0]!.provider, match_basis: "isbn", is_owner_confirmed: 1 }]);
    assert.equal((await getItem(db, saved.id)).item.isbn13, "9781974709939");

    calls.length = 0;
    const repeat = await lookupIsbn(db, { code: "9781974709939", source: "camera" }, { fetcher, googleBooksKey: key });
    assert.equal(calls.length, 0, "no provider request for a known ISBN");
    assert.equal(repeat.local, true);
    assert.equal(repeat.duplicate.level, "exact-isbn");
    assert.equal(repeat.duplicate.copies.length, 2);
    assert.equal(draftFor(repeat).item.volume, "1");

    await lookupIsbn(db, { code: "9781974729548", source: "camera" }, { fetcher, googleBooksKey: key });
    calls.length = 0;
    await lookupIsbn(db, { code: "9781974729548", source: "camera" }, { fetcher, googleBooksKey: key });
    assert.equal(calls.length, 0, "repeat lookups are served from the D1 metadata cache");
    await lookupIsbn(db, { code: "9781974729548", source: "camera", retry: true }, { fetcher, googleBooksKey: key });
    assert.ok(calls.length > 0, "retry bypasses the cache");
  } finally {
    await db.close();
  }
});

test("provider outages degrade to manual entry with the scanned ISBN kept, then recover on retry", async () => {
  const db = await seededCollection();
  try {
    const down = await replayFetcher({ outage: (url) => (url.hostname === "openlibrary.org" ? 503 : url.hostname === "www.googleapis.com" ? "timeout" : undefined) });
    const outage = await lookupIsbn(db, { code: "9784065266090", source: "camera" }, { fetcher: down, googleBooksKey: key });
    assert.equal(outage.editions.length, 0);
    assert.deepEqual(outage.failures.map((failure) => failure.provider).sort(), ["googlebooks", "openlibrary"]);
    assert.match(outage.warnings.join(" "), /Catalog services are unavailable/);
    const draft = draftFor(outage);
    assert.equal(draft.item.isbn13, "9784065266090");
    assert.equal(draft.item.title, "");
    assert.equal(draft.item.language, "JP", "the ISBN prefix is offered as a labeled assumption");
    assert.equal(draft.sources.language, "isbn-prefix");

    const calls: string[] = [];
    const recovered = await replayFetcher({ calls });
    const cachedFailure = await lookupIsbn(db, { code: "9784065266090", source: "camera" }, { fetcher: recovered, googleBooksKey: key });
    assert.equal(cachedFailure.failures.length, 2, "a recent failure is cached briefly instead of hammering the provider");
    assert.equal(calls.length, 0);
    const tooSoon = await lookupIsbn(db, { code: "9784065266090", source: "camera", retry: true }, { fetcher: recovered, googleBooksKey: key });
    assert.ok(
      tooSoon.failures.some((failure) => failure.provider === "openlibrary" && failure.status === 429),
      "a 503 back-off is honoured even when the owner retries",
    );
    // The back-off window passes.
    await db.batch([{ sql: "UPDATE provider_state SET blocked_until=NULL", params: [] }]);
    const retried = await lookupIsbn(db, { code: "9784065266090", source: "camera", retry: true }, { fetcher: recovered, googleBooksKey: key });
    assert.deepEqual(retried.failures, []);
    assert.equal(retried.matches[0]?.seriesTitle, "The Fragrant Flower Blooms With Dignity");

    const googleOnlyDown = await lookupIsbn(db, { code: "9781974709939", source: "camera" }, {
      fetcher: await replayFetcher({ outage: (url) => (url.hostname === "www.googleapis.com" ? 429 : undefined) }),
      googleBooksKey: key,
    });
    assert.equal(googleOnlyDown.editions[0]?.provider, "openlibrary", "one provider is enough");
    assert.equal(googleOnlyDown.failures[0]?.status, 429);
    assert.equal(preselectedMatch(googleOnlyDown)?.seriesTitle, "Chainsaw Man");

    const bridgeDown = await lookupIsbn(db, { code: "9784088818313", source: "camera" }, {
      fetcher: await replayFetcher({ outage: (url) => (url.hostname === "api.mangadex.org" ? 503 : undefined) }),
      googleBooksKey: key,
    });
    assert.equal(bridgeDown.editions.length, 1, "catalog data survives a bridge outage");
    assert.equal(preselectedMatch(bridgeDown), null, "without the bridge, no series is guessed");

    calls.length = 0;
    const noKey = await lookupIsbn(db, { code: "9781974709939", source: "camera", retry: true }, { fetcher: await replayFetcher({ calls }) });
    assert.ok(!calls.some((url) => url.includes("googleapis")), "without a key Google is skipped, not attempted");
    assert.equal(noKey.editions[0]?.provider, "openlibrary");
  } finally {
    await db.close();
  }
});

test("rate limits are shared fixed windows in D1 and reset per window", async () => {
  const db = openSqlite(":memory:");
  try {
    await migrateSqlite(db);
    const start = Date.UTC(2026, 9, 24, 12, 0, 5);
    for (let i = 0; i < 30; i++) await enforceRateLimits(db, SCAN_LIMITS, start + i * 100);
    await assert.rejects(enforceRateLimits(db, SCAN_LIMITS, start + 3100), (error: unknown) => error instanceof ApiError && error.status === 429 && /Wait \d+ seconds?/.test(error.message));
    await enforceRateLimits(db, SCAN_LIMITS, start + 60_000);
    const hour = [{ bucket: "test:hour", limit: 2, windowMs: 3_600_000 }];
    await enforceRateLimits(db, hour, start);
    await enforceRateLimits(db, hour, start + 1);
    await assert.rejects(enforceRateLimits(db, hour, start + 2), /Too many lookups/);
    const rows = await db.all("SELECT bucket FROM request_limits ORDER BY bucket");
    assert.deepEqual(rows.map((row) => row.bucket), ["scan-lookup:hour", "scan-lookup:minute", "test:hour"], "one row per window type, never per request");
  } finally {
    await db.close();
  }
});

test("scanned saves: new language editions, ISBN conflicts, idempotency, shared ISBN edits, CSV and backup compatibility", async () => {
  const db = await seededCollection();
  const restored = openSqlite(":memory:");
  try {
    await migrateSqlite(restored);
    const csvBefore = (await exportCsv(db, "manga")).split("\n")[0];
    const fetcher = await replayFetcher();
    const japanese = await lookupIsbn(db, { code: "9784088818313", source: "camera" }, { fetcher, googleBooksKey: key });
    const draft = draftFor(japanese);
    assert.equal(draft.item.seriesId, (await db.all("SELECT id FROM series WHERE canonical_title='Chainsaw Man'"))[0]!.id);
    const requestId = crypto.randomUUID();
    const value = itemSchema.parse({ ...draft.item, acquiredOn: "2026-10-24" });
    const saved = await saveItem(db, value, { requestId });
    assert.deepEqual(await saveItem(db, value, { requestId }), { id: saved.id, repeated: true }, "a repeated tap saves once");
    const runs = await db.all("SELECT edition_title,language FROM edition_runs r JOIN series s ON s.id=r.series_id WHERE s.canonical_title='Chainsaw Man' ORDER BY language");
    assert.deepEqual(runs.map((row) => ({ ...row })), [
      { edition_title: "Chainsaw Man", language: "EN" },
      { edition_title: "チェンソーマン", language: "JP" },
    ]);
    assert.equal((await db.all("SELECT COUNT(*) AS n FROM series WHERE canonical_title='Chainsaw Man'"))[0]!.n, 1);

    await assert.rejects(
      saveItem(db, { ...value, isbn13: "9784088820163", catalogSource: null }, { requestId: crypto.randomUUID() }),
      (error: unknown) => error instanceof ApiError && error.status === 409 && /already records ISBN 9784088818313/.test(error.message),
    );

    const second = await saveItem(db, { ...value, notes: "second copy" }, { requestId: crypto.randomUUID() });
    const current = await getItem(db, saved.id);
    const other = await getItem(db, second.id);
    await saveItem(db, { ...current.item, isbn13: null }, { id: saved.id, version: current.version });
    assert.equal((await getItem(db, second.id)).item.isbn13, null, "the ISBN belongs to the shared volume edition");
    assert.ok((await getItem(db, second.id)).version > other.version, "other copies are versioned so stale editors cannot overwrite it");

    assert.equal((await exportCsv(db, "manga")).split("\n")[0], csvBefore, "CSV columns are unchanged");
    await saveItem(db, { ...(await getItem(db, saved.id)).item, isbn13: "9784088818313" }, { id: saved.id, version: (await getItem(db, saved.id)).version });
    const backup = await exportBackup(db);
    assert.ok(backup.tables.volume_editions!.some((row) => row.isbn13 === "9784088818313"));
    assert.ok(!("request_limits" in backup.tables), "operational rate-limit state is not backed up");
    await restoreBackup(restored, backup, await revision(restored));
    assert.equal((await getItem(restored, saved.id)).item.isbn13, "9784088818313", "ISBNs survive a JSON restore");
  } finally {
    await db.close();
    await restored.close();
  }
});
