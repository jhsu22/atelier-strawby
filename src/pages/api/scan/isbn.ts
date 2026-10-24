import type { APIRoute } from "astro";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import { enforceRateLimits, SCAN_LIMITS } from "../../../server/http/rate-limit.ts";
import { lookupIsbn } from "../../../server/scan/lookup.ts";
import { SCAN_LOOKUP_BYTES } from "../../../domain/scan.ts";

// Owner-only (see middleware): not a public read, and writes need the
// same-origin X-Strawby-Request header. The body is a short ISBN string.
export const POST: APIRoute = ({ request, locals }) =>
  api(async () => {
    const db = d1Store(locals.runtime.env.DB);
    const body = await readJson(request, SCAN_LOOKUP_BYTES);
    await enforceRateLimits(db, SCAN_LIMITS);
    return lookupIsbn(db, body, {
      contact: locals.runtime.env.METADATA_CONTACT,
      googleBooksKey: locals.runtime.env.GOOGLE_BOOKS_API_KEY,
    });
  });
