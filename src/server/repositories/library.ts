import { sql } from "drizzle-orm";
import { createDb } from "../db/client.ts";
import { libraryData } from "../services/library.ts";

export function readLibrary(binding: D1Database, options: { owner: boolean }) {
  const db = createDb(binding);
  return libraryData(
    (query) => db.all<Record<string, unknown>>(sql.raw(query)),
    options,
  );
}
