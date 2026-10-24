import type { APIRoute } from "astro";
import { z } from "zod";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import {
  getItem,
  saveItem,
  deleteItem,
} from "../../../server/services/items.ts";
export const GET: APIRoute = ({ params, locals }) =>
  api(() => getItem(d1Store(locals.runtime.env.DB), params.id!));
export const PUT: APIRoute = ({ params, request, locals }) =>
  api(async () => {
    const body = z
      .object({ item: z.unknown(), version: z.number().int().positive() })
      .parse(await readJson(request));
    return saveItem(d1Store(locals.runtime.env.DB), body.item, {
      id: params.id!,
      version: body.version,
    });
  });
export const DELETE: APIRoute = ({ params, request, locals }) =>
  api(async () => {
    const body = z
      .object({
        version: z.number().int().positive(),
        confirmed: z.literal(true),
      })
      .parse(await readJson(request));
    return deleteItem(d1Store(locals.runtime.env.DB), params.id!, body.version);
  });
