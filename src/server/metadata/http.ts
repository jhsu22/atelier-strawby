import { digest, statement as s } from "../db/store.ts";
import type { Store } from "../db/store.ts";
import { ApiError } from "../http/api.ts";
export type Fetcher = typeof fetch;
export const providerHosts = new Set([
  "www.googleapis.com",
  "api.mangadex.org",
  "uploads.mangadex.org",
  "openlibrary.org",
  "covers.openlibrary.org",
  "musicbrainz.org",
  "coverartarchive.org",
  "itunes.apple.com",
]);
export function allowedProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (providerHosts.has(url.hostname) ||
        url.hostname === "archive.org" ||
        url.hostname.endsWith(".archive.org"))
    );
  } catch {
    return false;
  }
}
export async function boundedFetch(
  url: string,
  init: RequestInit,
  limit: number,
  fetcher: Fetcher = fetch,
): Promise<{ response: Response; bytes: Uint8Array }> {
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; redirects <= 4; redirects++) {
    // A credential must never follow a redirect to an image host or another provider.
    if (new Headers(init.headers).has("X-Goog-Api-Key") && new URL(url).origin !== "https://www.googleapis.com")
      throw new ApiError(502, "Google Books returned an unexpected redirect.");
    if (!allowedProviderUrl(url))
      throw new ApiError(422, "Provider URL is not allowed.");
    const response = await fetcher(url, {
      ...init,
      signal,
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location)
        throw new ApiError(502, "Provider returned an invalid redirect.");
      url = new URL(location, url).href;
      continue;
    }
    if (Number(response.headers.get("content-length") ?? 0) > limit) {
      await response.body?.cancel();
      throw new ApiError(502, "Provider response exceeds the size limit.");
    }
    const reader = response.body?.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > limit) {
          await reader.cancel();
          throw new ApiError(502, "Provider response exceeds the size limit.");
        }
        chunks.push(part.value);
      }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { response, bytes };
  }
  throw new ApiError(502, "Too many provider redirects.");
}
export async function reserveProvider(
  db: Store,
  provider: string,
  spacing = 1100,
): Promise<void> {
  // Conditional UPDATE RETURNING is a shared D1 lease, including across isolates.
  const start = Date.now();
  await db.batch([
    s(
      "INSERT INTO provider_state(provider,next_allowed_at) VALUES (?,'1970-01-01T00:00:00.000Z') ON CONFLICT(provider) DO NOTHING",
      provider,
    ),
  ]);
  while (Date.now() - start < 2500) {
    const now = new Date().toISOString();
    const rows = await db.all(
      `UPDATE provider_state SET next_allowed_at=? WHERE provider=? AND next_allowed_at<=? AND (blocked_until IS NULL OR blocked_until<=?) RETURNING provider`,
      [new Date(Date.now() + spacing).toISOString(), provider, now, now],
    );
    if (rows.length) return;
    const row = (
      await db.all(
        "SELECT blocked_until FROM provider_state WHERE provider=?",
        [provider],
      )
    )[0];
    if (row?.blocked_until && String(row.blocked_until) > now)
      throw new ApiError(
        429,
        "The provider asked us to wait. Retry later; manual entry is available.",
      );
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new ApiError(
    429,
    "Metadata lookup is busy. Wait a few seconds and retry.",
  );
}
export async function providerJson(
  db: Store,
  provider: string,
  url: string,
  options: { retry?: boolean; contact?: string; fetcher?: Fetcher; googleBooksKey?: string } = {},
): Promise<unknown> {
  const cacheKey = `provider-v1:${provider}:${await digest(url)}`,
    now = new Date().toISOString();
  const cached = (
    await db.all("SELECT * FROM metadata_cache WHERE cache_key=?", [cacheKey])
  )[0];
  if (!options.retry && cached && String(cached.expires_at) > now) {
    if (cached.status === "ready")
      return JSON.parse(String(cached.payload_json));
    if (cached.status === "missing") return null;
    throw new ApiError(
      502,
      "The provider was recently unavailable. Retry lookup or enter details manually.",
    );
  }
  await reserveProvider(db, provider, provider === "itunes" ? 3100 : 1100);
  let payload: unknown = null,
    status = "ready",
    ttl = 7 * 86400000;
  try {
    const { response, bytes } = await boundedFetch(
      url,
      {
        headers: {
          Accept: "application/json",
          ...(provider === "googlebooks" && new URL(url).origin === "https://www.googleapis.com"
            ? { "X-Goog-Api-Key": options.googleBooksKey ?? "" } : {}),
          "User-Agent": `StrawbyStacks/0.2 (${options.contact || "https://github.com/jhsu22/atelier-strawby"})`,
        },
      },
      950000,
      options.fetcher,
    );
    if (response.status === 404) {
      status = "missing";
      ttl = 3600000;
    } else {
      if ([429, 503].includes(response.status)) {
        const value = response.headers.get("retry-after") ?? "60";
        const wait = /^\d+$/.test(value)
          ? Number(value) * 1000
          : Date.parse(value) - Date.now();
        const until = new Date(
          Date.now() +
            Math.max(
              60000,
              Math.min(Number.isFinite(wait) ? wait : 60000, 86400000),
            ),
        ).toISOString();
        await db.batch([
          s(
            "UPDATE provider_state SET blocked_until=? WHERE provider=?",
            until,
            provider,
          ),
        ]);
        throw new ApiError(
          429,
          "The provider is rate limiting requests. Retry later.",
        );
      }
      if (provider === "googlebooks" && [400, 401, 403].includes(response.status)) {
        let limited = false;
        try {
          const error = JSON.parse(new TextDecoder().decode(bytes));
          limited = Array.isArray(error?.error?.errors) && error.error.errors.some((entry: {reason?: string}) =>
            ["dailyLimitExceeded", "quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(entry.reason ?? ""));
        } catch { /* Provider messages and credentials are never echoed. */ }
        if (limited) throw new ApiError(429, "Google Books quota is exhausted. Wait for its quota to reset; other sources and manual entry remain available.");
        throw new ApiError(422, "Google Books rejected access. Check that Books API is enabled and the API key is valid and restricted for server requests.");
      }
      if (!response.ok)
        throw new ApiError(
          502,
          "The metadata provider is unavailable. Manual entry is available.",
        );
      payload = JSON.parse(new TextDecoder().decode(bytes));
    }
  } catch (error) {
    await db.batch([
      s(
        `INSERT INTO metadata_cache(cache_key,provider,adapter_version,payload_json,status,fetched_at,expires_at)
      VALUES (?,?,'1',NULL,'failed',?,?) ON CONFLICT(cache_key) DO UPDATE SET status='failed',payload_json=NULL,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`,
        cacheKey,
        provider,
        now,
        new Date(Date.now() + 60000).toISOString(),
      ),
    ]);
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "Metadata lookup timed out or returned invalid data. Manual entry is available.",
    );
  }
  await db.batch([
    s(
      `INSERT INTO metadata_cache(cache_key,provider,adapter_version,payload_json,status,fetched_at,expires_at) VALUES (?,?,'1',?,?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,status=excluded.status,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`,
      cacheKey,
      provider,
      payload === null ? null : JSON.stringify(payload),
      status,
      now,
      new Date(Date.now() + ttl).toISOString(),
    ),
  ]);
  return payload;
}
