import type { APIRoute } from "astro";
import { z } from "zod";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import { saveItem } from "../../../server/services/items.ts";
export const POST: APIRoute = ({ request, locals }) =>
  api(async () => {
    const body = z
      .object({ item: z.unknown(), requestId: z.string().uuid() })
      .parse(await readJson(request));
    return saveItem(d1Store(locals.runtime.env.DB), body.item, {
      requestId: body.requestId,
    });
  }, 201);
