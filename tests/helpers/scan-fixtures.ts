import { readFile } from "node:fs/promises";
import { openSqlite, migrateSqlite } from "../../scripts/lib/sqlite.ts";
import { normalizeCsv } from "../../scripts/lib/normalize.ts";
import { persistPlan } from "../../scripts/lib/import.ts";

export interface IsbnCase {
  isbn: string;
  code?: string;
  label: string;
  tags: string[];
  expect: {
    series: string | null;
    volume: string | null;
    language: "EN" | "JP" | "KR";
    duplicate: "exact-isbn" | "same-volume" | "none";
    flag?: string;
  };
}
export interface InvalidCase { code: string; problem: string; label: string }

export async function isbnCases(): Promise<{ cases: IsbnCase[]; invalid: InvalidCase[] }> {
  return JSON.parse(await readFile("tests/fixtures/scan/isbn-cases.json", "utf8"));
}

/** Replays recorded live responses; any unrecorded request fails the test. */
export async function replayFetcher(
  options: { outage?: (url: URL) => number | "timeout" | undefined; calls?: string[] } = {},
): Promise<typeof fetch> {
  const { responses } = JSON.parse(await readFile("tests/fixtures/scan/recorded-responses.json", "utf8")) as {
    responses: Record<string, { status: number; contentType: string; body: string }>;
  };
  return async (input) => {
    const url = String(input);
    options.calls?.push(url);
    const outage = options.outage?.(new URL(url));
    if (outage === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
    if (outage) return new Response("unavailable", { status: outage });
    const recorded = responses[url];
    if (!recorded) throw new Error(`Unrecorded provider request: ${url}`);
    return new Response(recorded.body, { status: recorded.status, headers: { "content-type": recorded.contentType } });
  };
}

/** A disposable database holding the owner's real seeded collection. */
export async function seededCollection() {
  const db = openSqlite(":memory:");
  await migrateSqlite(db);
  await persistPlan(db, normalizeCsv(await readFile("initial_collection.csv", "utf8")));
  return db;
}
