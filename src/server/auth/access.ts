import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { allowLocalAccess } from "./local-access.ts";
export interface AccessEnv {
  APP_ENV?: string;
  LOCAL_DEV_AUTH?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUDIENCE?: string;
  ACCESS_OWNER_EMAIL?: string;
  APP_ORIGIN?: string;
}
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authorize(
  request: Request,
  env: AccessEnv,
  testKey?: JWTVerifyGetKey,
): Promise<boolean> {
  const url = new URL(request.url);
  if (allowLocalAccess(url, env)) return true;
  if (
    !["production", "preview"].includes(env.APP_ENV ?? "") ||
    !env.APP_ORIGIN ||
    url.origin !== env.APP_ORIGIN ||
    !env.ACCESS_AUDIENCE ||
    !env.ACCESS_OWNER_EMAIL ||
    !env.ACCESS_TEAM_DOMAIN
  )
    return false;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN))
    return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) return false;
  try {
    if (!testKey && !keys.has(issuer))
      keys.set(
        issuer,
        createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
          timeoutDuration: 5000,
        }),
      );
    const { payload } = await jwtVerify(token, testKey ?? keys.get(issuer)!, {
      algorithms: ["RS256"],
      issuer,
      audience: env.ACCESS_AUDIENCE,
      requiredClaims: ["exp", "iat", "sub", "email"],
    });
    return (
      typeof payload.email === "string" &&
      payload.email.toLowerCase() === env.ACCESS_OWNER_EMAIL.toLowerCase()
    );
  } catch {
    return false;
  }
}
export function validMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return (
    origin === new URL(request.url).origin &&
    !["cross-site", "same-site"].includes(
      request.headers.get("sec-fetch-site") ?? "",
    ) &&
    request.headers.get("x-strawby-request") === "1"
  );
}
