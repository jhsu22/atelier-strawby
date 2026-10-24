import { defineMiddleware } from "astro:middleware";
import { authorize, validMutationOrigin } from "./server/auth/access.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  const env = context.locals.runtime?.env;
  if (!env || !(await authorize(context.request, env))) {
    return new Response("Collection access is not authorized or configured.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (
    !["GET", "HEAD"].includes(context.request.method) &&
    !validMutationOrigin(context.request)
  ) {
    return Response.json(
      { error: "This operation must come from the collection application." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const response = await next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
});
