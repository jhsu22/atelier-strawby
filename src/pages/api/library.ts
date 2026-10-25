import type { APIRoute } from "astro";
import { readLibrary } from "../../server/repositories/library.ts";

export const GET: APIRoute = async ({ locals }) => {
  try {
    // Public: private notes are omitted. The owner refreshes from /api/library/owner.
    return Response.json(
      await readLibrary(locals.runtime.env.DB, { owner: false }),
    );
  } catch {
    return Response.json(
      { error: "The collection could not be refreshed. Please try again." },
      { status: 503 },
    );
  }
};
