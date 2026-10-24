import type { JWTVerifyGetKey } from "jose";
import { authorize, configuredOrigin, validMutationOrigin } from "./access.ts";
import type { AccessEnv } from "./access.ts";

const headers = { "Cache-Control": "private, no-store" };
export function publicRead(request: Request): boolean {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  return ["/", "/foundation", "/api/library", "/api/releases"].includes(path) ||
    /^\/api\/artwork\/[^/]+$/.test(path);
}

export async function requestAccess(request: Request, env?: AccessEnv, testKey?: JWTVerifyGetKey) {
  if (!env || !configuredOrigin(request, env))
    return { isOwner: false, response: new Response("Collection access is not configured for this address.", { status: 503, headers }) };
  // Public reads never need an identity check or an external JWKS request.
  if (publicRead(request)) return { isOwner: false };
  const isOwner = await authorize(request, env, testKey);
  if (!isOwner)
    return { isOwner, response: Response.json({ error: "Sign in as the collection owner to use editing tools." }, { status: 403, headers }) };
  if (!["GET", "HEAD"].includes(request.method) && !validMutationOrigin(request))
    return { isOwner, response: Response.json({ error: "This operation must come from the collection application." }, { status: 403, headers }) };
  return { isOwner };
}
