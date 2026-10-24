import { readFile, writeFile } from "node:fs/promises";
import { openSqlite, migrateSqlite } from "./lib/sqlite.ts";
import { normalizeCsv } from "./lib/normalize.ts";
import { persistPlan } from "./lib/import.ts";
import { lookupIsbn } from "../src/server/scan/lookup.ts";

// Records the live provider responses that the Phase A ISBN test set needs.
// It runs the real lookup against a disposable copy of the seeded collection,
// so fixtures contain exactly the requests the code makes. The Google key is
// only ever sent as a header; URLs and stored bodies never contain it.
// Usage: node scripts/record-scan-fixtures.ts   (needs network + .dev.vars key)
const cases = JSON.parse(await readFile("tests/fixtures/scan/isbn-cases.json", "utf8")) as {
  cases: { isbn: string; code?: string }[];
};
const vars = await readFile(".dev.vars", "utf8").catch(() => "");
const googleBooksKey = vars.match(/^GOOGLE_BOOKS_API_KEY=(.*)$/m)?.[1]?.trim() || undefined;
if (!googleBooksKey) console.warn("No GOOGLE_BOOKS_API_KEY in .dev.vars; recording Open Library and MangaDex only.");

const recorded: Record<string, { status: number; contentType: string; body: string }> = {};
const recorder: typeof fetch = async (input, init) => {
  const url = String(input);
  for (let attempt = 1; ; attempt++) {
    let response: Response, body: string;
    try {
      // A fresh deadline per attempt; the caller's signal would already be spent.
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
      body = await response.text();
    } catch (error) {
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
        continue;
      }
      throw error;
    }
    // Transient outages are retried so the fixture describes the catalog itself.
    if (response.status >= 500 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      continue;
    }
    if (googleBooksKey && body.includes(googleBooksKey)) throw new Error("A provider echoed the API key; refusing to record.");
    recorded[url] = { status: response.status, contentType: response.headers.get("content-type") ?? "application/json", body };
    return new Response(body, { status: response.status, headers: { "content-type": recorded[url].contentType } });
  }
};

const db = openSqlite(":memory:");
let failed = 0;
try {
  await migrateSqlite(db);
  await persistPlan(db, normalizeCsv(await readFile("initial_collection.csv", "utf8")));
  for (const entry of cases.cases) {
    const result = await lookupIsbn(db, { code: entry.code ?? entry.isbn, source: "manual" }, { fetcher: recorder, ...(googleBooksKey ? { googleBooksKey } : {}) });
    const best = result.matches[0];
    if (result.failures.length) failed++;
    console.log(
      `${entry.isbn}  editions=${result.editions.filter((e) => e.isbnVerified).length}/${result.editions.length}`,
      `match=${best ? `${best.seriesTitle} (${best.score}, ${best.basis})` : "-"}`,
      `dup=${result.duplicate.level}`,
      result.failures.length ? `failures=${JSON.stringify(result.failures)}` : "",
    );
  }
} finally {
  await db.close();
}
if (failed && !process.argv.includes("--allow-failures")) {
  console.error(`${failed} lookups hit a provider failure; fixtures were not written. Retry later, or pass --allow-failures.`);
  process.exit(1);
}
const ordered = Object.fromEntries(Object.entries(recorded).sort(([a], [b]) => a.localeCompare(b)));
await writeFile("tests/fixtures/scan/recorded-responses.json", `${JSON.stringify({ recordedAt: new Date().toISOString(), responses: ordered }, null, 1)}\n`);
console.log(`Recorded ${Object.keys(ordered).length} provider responses.`);
