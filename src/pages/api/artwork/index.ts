import type { APIRoute } from "astro";
import { z } from "zod";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import { cacheItemArtwork } from "../../../server/metadata/artwork.ts";
export const POST: APIRoute = ({ request, locals }) =>
  api(async () => {
    const body = z
      .object({ itemId: z.string().min(1).max(100) })
      .parse(await readJson(request, 2000));
    return cacheItemArtwork(
      d1Store(locals.runtime.env.DB),
      locals.runtime.env.COVERS,
      body.itemId,
    );
  });
