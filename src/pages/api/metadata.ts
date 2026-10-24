import type { APIRoute } from "astro";
import { api, readJson } from "../../server/http/api.ts";
import { d1Store } from "../../server/db/store.ts";
import { lookupMetadata } from "../../server/metadata/providers.ts";
export const POST: APIRoute = ({ request, locals }) =>
  api(async () =>
    lookupMetadata(
      d1Store(locals.runtime.env.DB),
      await readJson(request, 16000),
      { contact: locals.runtime.env.METADATA_CONTACT },
    ),
  );
