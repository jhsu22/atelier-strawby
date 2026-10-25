import type { APIRoute } from "astro";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import { saveHaul } from "../../../server/services/hauls.ts";
import { HAUL_REQUEST_BYTES } from "../../../domain/haul.ts";

// Owner-only (see middleware): not a public read, and writes need the
// same-origin X-Strawby-Request header.
export const POST: APIRoute = ({ request, locals }) =>
  api(async () => saveHaul(d1Store(locals.runtime.env.DB), await readJson(request, HAUL_REQUEST_BYTES)), 201);
