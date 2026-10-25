import type { APIRoute } from "astro";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import { enforceRateLimits, CD_SCAN_LIMITS } from "../../../server/http/rate-limit.ts";
import { lookupCdBarcode } from "../../../server/scan/cd.ts";
import { CD_LOOKUP_BYTES } from "../../../domain/cd-scan.ts";

// Owner-only (see middleware), like the ISBN lookup, with its own rate limits.
export const POST: APIRoute = ({ request, locals }) =>
  api(async () => {
    const db = d1Store(locals.runtime.env.DB);
    const body = await readJson(request, CD_LOOKUP_BYTES);
    await enforceRateLimits(db, CD_SCAN_LIMITS);
    return lookupCdBarcode(db, body, { contact: locals.runtime.env.METADATA_CONTACT });
  });
