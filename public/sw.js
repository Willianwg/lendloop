// LendLoop service worker: an app shell for fast reloads and an offline page. Nothing else.
//
// - Precaches /offline, the assets it needs, and the icons.
// - Cache-first for same-origin /_next/static/* (content-hashed) and /icons/*.
// - Network-first for page navigations, falling back to /offline. Pages are never cached:
//   they belong to a signed-in user.
// - Everything else (cross-origin, /api, Convex, Clerk, RSC payloads) goes straight to the
//   network and is never stored.
//
// Bump VERSION to drop every older cache on activate.
const VERSION = "v1";
const CACHE = `lendloop-shell-${VERSION}`;
const OFFLINE_URL = "/offline";
const ICONS = ["/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch(OFFLINE_URL, { cache: "reload", credentials: "omit" });
      if (!response.ok) throw new Error(`offline page: ${response.status}`);
      // The offline page's own CSS, fonts and scripts, so it renders styled with no network.
      const html = await response.clone().text();
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? [])];
      await cache.put(OFFLINE_URL, response);
      await cache.addAll([...ICONS, ...assets]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("lendloop-") && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isShellAsset(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
  // Anything else: no respondWith, so the browser handles it and nothing is cached.
});
