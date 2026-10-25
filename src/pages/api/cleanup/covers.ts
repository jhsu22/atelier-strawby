import type { APIRoute } from "astro";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import { coverCandidates } from "../../../server/metadata/cover-utility.ts";

// Owner-only (see middleware). A POST because it may contact cover providers.
export const POST: APIRoute = ({ request, locals }) =>
  api(async () =>
    coverCandidates(d1Store(locals.runtime.env.DB), await readJson(request, 2000), {
      contact: locals.runtime.env.METADATA_CONTACT,
    }),
  );
