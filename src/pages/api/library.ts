import type { APIRoute } from "astro";
import { readLibrary } from "../../server/repositories/library.ts";

export const GET: APIRoute = async ({ locals }) => {
  try {
    return Response.json(await readLibrary(locals.runtime.env.DB));
  } catch {
    return Response.json(
      { error: "The collection could not be refreshed. Please try again." },
      { status: 503 },
    );
  }
};
