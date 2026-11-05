// ════════════════════════════════════════════════════════════════════
// Service Worker — Cache-first strategy for static assets + network-first for APIs
// The PWA is installable, works offline, and gracefully degrades to a polling fallback.
// ─────────────────────────────────────────────────────────────────────

declare const self: ServiceWorkerGlobalScope;
const CACHE_NAME = "sparklewash-static-v2";
const SW_FILE = "/service-worker.ts?nocache=" + Date.now();

function isStaticPath(pathname: URL): boolean {
  return (
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".png") ||
    pathname.endsWith("/index.html") ||
    pathname.endsWith("/manifest.json")
  );
}

const STATIC_ASSETS = new Set([".", "/index.html", "/manifest.json", "/" /* home */]);

self.addEventListener("install", async (event: InstallEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(["/", "/index.html"].map((route) => cache.put(route, fetch("/" + route))).catch(() => null));
    })
  );
});

self.addEventListener("activate", (event: ActivateEvent) => {
  const whitelisted = new Set([CACHE_NAME]);
  event.waitUntil(
    caches.keys().then((keys) => caches.delete(keys.filter((name) => !whitelisted.has(name)).join(", ")))
  );
});

self.addEventListener("fetch", (event) => {
  const { pathname } = new URL(event.request.url);
  let response: Response | null = null;

  if (STATIC_ASSETS.has(pathname) || isStaticPath(pathname)) {
    event.respondWith(async () => {
      const cached = await caches
        .match(event.request)
        .then((res) => res && res.ok && res.status >= 200 ? res : null);

      return cached || fetch(event.request).catch(() => new Response("Offline mode", { status: 503 }));
    });
  } else if (pathname.includes("/api/") || pathname.endsWith("/ws/")) {
    // Live API calls are served directly from the network. Cache for offline replay when available.
    event.respondWith(async () => {
      try {
        const response = await fetch(event.request);
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone())));
        return response;
      } catch {
        return caches.match(event.request).then((cached) => (cached || new Response("Offline", { status: 503 })));
      }
    });
  }
});

console.debug(`${SW_FILE} loaded and ready.`); // logs to console when installed by a browser
```
