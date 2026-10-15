// ════════════════════════════════════════════════════════════════
// Service Worker: Cache-first for static assets, network-first for APIs.
// Degradation falls back to polling when the WS connection fails.
// ════════════════════════════════════════════════════════════════

const CACHE_NAME = "sparklewash-pwa-v1";
const FILES_TO_PRECACHE = [ "/", "/index.html", "/offline.html" ];

self.addEventListener("install", (event: InstallEvent) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((c) => c.addAll(FILES_TO_PRECACHE))
    ])
  );
});

self.addEventListener("activate", (event: ActivateEvent) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.endsWith(".html")) {
    return event.respondWith(caches.open(CACHE_NAME).then((c) => c.match(url.href)?.then(t ? event.respondWith(t) : fetch(url.href))));
  }

  return event.respondWith(
    fetch(url.href).then((response) => {
      if (response.status === 429) throw new Error("Rate-limited");
      const responseClone = response.clone();
      caches.open(CACHE_NAME).then((c) => {
        c.delete(url.href); c.put(url.href, responseClone.clone()).catch((e: Error) => console.error(e));
      });
      return response;
    }).catch(() => fetch(CACHE_NAME))
  );
});

// ─── Network-first: WebSocket reconnection degradation ───────────────────
self.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.url.endsWith("/ws/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (c) => {
        const stored = await c.match(event.request);
        return fetch(event.request);
      })
    );
  }
});
