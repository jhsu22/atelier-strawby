import type { APIRoute } from "astro";
import { readLibrary } from "../../../server/repositories/library.ts";

// Not a public read: the middleware requires the verified owner, so this view
// may include private notes and their derived memory tags.
export const GET: APIRoute = async ({ locals }) => {
  try {
    return Response.json(
      await readLibrary(locals.runtime.env.DB, { owner: true }),
    );
  } catch {
    return Response.json(
      { error: "The collection could not be refreshed. Please try again." },
      { status: 503 },
    );
  }
};
