import type { APIRoute } from "astro";
import { api, readJson } from "../../server/http/api.ts";
import { d1Store } from "../../server/db/store.ts";
import { lookupReleasedVolumes, readReleaseCatalog, releaseLookupSchema } from "../../server/metadata/releases.ts";
export const GET: APIRoute = ({url, locals}) => api(async () => {
  const {editionRunId} = releaseLookupSchema.parse({editionRunId: url.searchParams.get("editionRunId")});
  return {catalog: await readReleaseCatalog(d1Store(locals.runtime.env.DB), editionRunId)};
});
export const POST: APIRoute = ({request, locals}) => api(async () => ({catalog: await lookupReleasedVolumes(d1Store(locals.runtime.env.DB), await readJson(request, 4000), {googleBooksKey: locals.runtime.env.GOOGLE_BOOKS_API_KEY, contact: locals.runtime.env.METADATA_CONTACT})}));
