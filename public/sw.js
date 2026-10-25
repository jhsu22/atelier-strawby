// Offline shelf. A deliberately small allowlist: the two shelf pages, the two
// library reads, hashed build assets, fonts, icons and artwork. Writes, item
// editor data, imports, exports, lookups and every other route always go to the
// network and are never stored. Cached owner pages stay on this device only.
const VERSION = "strawby-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const ARTWORK = `${VERSION}-artwork`;
const SHELF_PAGES = new Set(["/", "/edit"]);
const LIBRARY = new Set(["/api/library", "/api/library/owner"]);
const PRECACHE = ["/favicon.svg", "/manifest.webmanifest", "/manifest-edit.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
// Bookstore signal is often slow rather than absent; fall back after this long.
const NETWORK_TIMEOUT_MS = 4000;
const ARTWORK_LIMIT = 800;
// Each deploy adds new hashed assets; the oldest are evicted (a build has a handful).
const STATIC_LIMIT = 120;
// The shelf reads this to tell how old an offline copy is.
const SAVED_AT = "x-strawby-saved-at";

const shelfPath = (url) => url.pathname.replace(/\/+$/, "") || "/";
const isStatic = (path) => path.startsWith("/_astro/") || path.startsWith("/fonts/") || path.startsWith("/icons/") || PRECACHE.includes(path);
const isArtwork = (path) => /^\/api\/artwork\/[^/]+$/.test(path);
const storable = (response) => response.ok && response.status === 200 && response.type === "basic" && !response.redirected;

async function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set(SAVED_AT, String(Date.now()));
  return new Response(await response.clone().blob(), { status: response.status, statusText: response.statusText, headers });
}
async function trim(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
const offlinePage = () =>
  new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Atelier Strawby — Offline</title>' +
      '<body style="font-family:system-ui,sans-serif;padding:24px;background:#faf8f5;color:#141413"><h1>You’re offline</h1>' +
      "<p>This page hasn’t been saved on this device yet. Open the shelf once while connected and it will be available offline.</p></body></html>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

/** Network first with a timeout; the stored copy answers when the network can't. */
async function networkFirst(request, cacheName, key, fallback) {
  const cache = await caches.open(cacheName);
  const network = fetch(request).then(async (response) => {
    if (storable(response)) await cache.put(key, await stamp(response));
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, "timeout"));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== "timeout") return first;
    const saved = await cache.match(key);
    if (saved) {
      network.catch(() => {});
      return saved;
    }
    return await network;
  } catch {
    return (await cache.match(key)) ?? fallback();
  }
}
async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (storable(response)) {
    await cache.put(request, response.clone());
    if (limit) await trim(cacheName, limit);
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (!key.startsWith(`${VERSION}-`)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
// The first visit loads before this worker controls the page; the page then
// lists what it already loaded so the same allowlist can store it.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "strawby:store" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    Promise.all(
      event.data.urls.slice(0, 300).map(async (value) => {
        try {
          const url = new URL(value, self.location.origin);
          if (url.origin !== self.location.origin) return;
          const path = shelfPath(url);
          if (SHELF_PAGES.has(path)) {
            const response = await fetch(path, { credentials: "same-origin" });
            if (storable(response)) await (await caches.open(PAGES)).put(path, await stamp(response));
          } else if (isStatic(path)) await cacheFirst(new Request(url), STATIC, STATIC_LIMIT);
          else if (isArtwork(path)) await cacheFirst(new Request(url), ARTWORK, ARTWORK_LIMIT);
        } catch {
          // Best effort: an asset that can't be stored now is stored on next use.
        }
      }),
    ),
  );
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = shelfPath(url);
  // Query strings (shelf filters, an open item) share one stored page per path.
  if (request.mode === "navigate" && SHELF_PAGES.has(path)) event.respondWith(networkFirst(request, PAGES, path, offlinePage));
  else if (LIBRARY.has(path)) event.respondWith(networkFirst(request, PAGES, path, () => Response.json({ error: "You’re offline and the collection hasn’t been saved on this device yet." }, { status: 503 })));
  else if (isStatic(path)) event.respondWith(cacheFirst(request, STATIC, STATIC_LIMIT));
  else if (isArtwork(path)) event.respondWith(cacheFirst(request, ARTWORK, ARTWORK_LIMIT));
});
