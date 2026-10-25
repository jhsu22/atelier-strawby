import type { APIRoute } from "astro";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import { applyCleanup } from "../../../server/services/cleanup.ts";
import { CLEANUP_REQUEST_BYTES } from "../../../domain/cleanup.ts";

// Owner-only (see middleware): writes need the same-origin X-Strawby-Request header.
export const POST: APIRoute = ({ request, locals }) =>
  api(async () => applyCleanup(d1Store(locals.runtime.env.DB), await readJson(request, CLEANUP_REQUEST_BYTES)));
