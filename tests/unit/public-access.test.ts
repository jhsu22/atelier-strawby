import test from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { requestAccess } from "../../src/server/auth/request-access.ts";

const origin = "https://library.example.com";
const env = {
  APP_ENV: "production", APP_ORIGIN: origin,
  ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com", ACCESS_AUDIENCE: "owner-editing",
  ACCESS_OWNER_EMAIL: "owner@example.com",
};
const request = (path: string, method = "GET", headers: Record<string, string> = {}) =>
  new Request(origin + path, { method, headers });

test("anonymous visitors can browse and view artwork, but cannot open editor data, backups or any write endpoint", async () => {
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/", "/foundation/", "/api/library", "/api/releases?editionRunId=edition", "/api/artwork/cover-id"]) {
      const result = await requestAccess(request(path, method), env);
      assert.equal(result.response, undefined, `${method} ${path}`);
      assert.equal(result.isOwner, false);
    }
  }
  for (const path of ["/edit", "/edit/", "/api/export", "/api/export?kind=manga", "/api/imports", "/api/items/id", "/api/metadata", "/api/artwork", "/api/future-admin-tool"]) {
    assert.equal((await requestAccess(request(path), env)).response?.status, 403, path);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    for (const path of ["/", "/api/library", "/api/items", "/api/items/id", "/api/imports", "/api/releases", "/api/metadata", "/api/artwork"]) {
      const result = await requestAccess(request(path, method, { origin, "x-strawby-request": "1", "sec-fetch-site": "same-origin" }), env);
      assert.equal(result.response?.status, 403, `${method} ${path}`);
      assert.match(await result.response!.text(), /collection owner/);
    }
  }
  assert.equal((await requestAccess(request("/"), { ...env, APP_ORIGIN: "https://other.example.com" })).response?.status, 503);
  assert.equal((await requestAccess(request("/"))).response?.status, 503);
  assert.equal((await requestAccess(request("/"), { APP_ENV: "local", LOCAL_DEV_AUTH: "true" })).response?.status, 503);
});

test("signed owner cookie authorizes editing APIs while forged, expired and non-owner cookies fail; CSRF checks still apply", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const token = (email = env.ACCESS_OWNER_EMAIL, audience = env.ACCESS_AUDIENCE, expiry: string | number = "1h") =>
    new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("owner").setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`).setAudience(audience)
      .setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  const valid = await token();
  const cookies = [await token("visitor@example.com"), await token(env.ACCESS_OWNER_EMAIL, "other-app"), await token(env.ACCESS_OWNER_EMAIL, env.ACCESS_AUDIENCE, 1), valid.slice(0, -8) + "tampered", "fake", "x".repeat(17000)];
  for (const cookie of cookies) {
    const result = await requestAccess(request("/api/items/id", "GET", { cookie: `CF_Authorization=${cookie}` }), env, keys);
    assert.equal(result.response?.status, 403);
  }
  const headers = { cookie: `theme=dark; CF_Authorization=${valid}; other=value`, origin, "x-strawby-request": "1", "sec-fetch-site": "same-origin" };
  for (const [path, method] of [["/edit", "GET"], ["/api/export", "GET"], ["/api/items", "POST"], ["/api/items/id", "PUT"], ["/api/items/id", "DELETE"], ["/api/imports", "PUT"], ["/api/releases", "POST"], ["/api/metadata", "POST"], ["/api/artwork", "POST"]]) {
    const result = await requestAccess(request(path!, method!, headers), env, keys);
    assert.equal(result.response, undefined, `${method} ${path}`);
    assert.equal(result.isOwner, true);
  }
  for (const change of [{ origin: "https://attacker.example" }, { "sec-fetch-site": "cross-site" }, { "x-strawby-request": "" }]) {
    assert.equal((await requestAccess(request("/api/items", "POST", { ...headers, ...change }), env, keys)).response?.status, 403);
  }
});
