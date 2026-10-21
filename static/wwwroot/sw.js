// Cache the app shell and visited same-origin assets. API freshness belongs to
// useDashboard; do not disguise cached telemetry as a successful network poll.
const CACHE_NAME = 'sparklewash-shell-v2';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(['/', '/index.html', '/offline.html'])));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith('sparklewash-') && name !== CACHE_NAME)
    .map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/') ||
      url.pathname === '/healthz' || url.pathname === '/openapi.json') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      if (event.request.mode === 'navigate') return (await cache.match('/index.html')) || (await cache.match('/offline.html'));
      return Response.error();
    }
  })());
});
