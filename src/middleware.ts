import { defineMiddleware } from "astro:middleware";
import { requestAccess } from "./server/auth/request-access.ts";
import { allowLocalAccess } from "./server/auth/local-access.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  const env = context.locals.runtime?.env;
  const access = await requestAccess(context.request, env);
  if (access.response) return access.response;
  // Local owner mode retains the existing editing workflow. Hosted visitors
  // always get a read-only shelf at /, even after the owner has signed in.
  const localOwner = env && allowLocalAccess(context.url, env);
  context.locals.canEdit = Boolean(localOwner || (access.isOwner && context.url.pathname.replace(/\/+$/, "") === "/edit"));
  const response = await next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  if (context.locals.canEdit) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
});
