import type { APIRoute } from "astro";
import { z } from "zod";
import { api, readJson } from "../../../server/http/api.ts";
import { d1Store } from "../../../server/db/store.ts";
import {
  createImportPreview,
  commitImport,
  cancelImport,
  pendingImport,
} from "../../../server/services/transfer.ts";
export const GET: APIRoute = ({ locals }) =>
  api(() => pendingImport(d1Store(locals.runtime.env.DB)));
export const POST: APIRoute = ({ request, locals }) =>
  api(async () =>
    createImportPreview(
      d1Store(locals.runtime.env.DB),
      await readJson(request, 1100000),
    ),
  );
export const PUT: APIRoute = ({ request, locals }) =>
  api(async () => {
    const body = z
      .object({
        token: z.string().uuid(),
        includeDuplicates: z.boolean(),
        confirmed: z.literal(true),
      })
      .parse(await readJson(request, 2000));
    return commitImport(
      d1Store(locals.runtime.env.DB),
      body.token,
      body.includeDuplicates,
    );
  });
export const DELETE: APIRoute = ({ request, locals }) =>
  api(async () => {
    const body = z
      .object({ token: z.string().uuid(), confirmed: z.literal(true) })
      .parse(await readJson(request, 2000));
    return cancelImport(d1Store(locals.runtime.env.DB), body.token);
  });
