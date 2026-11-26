const CACHE_NAME = "drillgre-shell-v1";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/assets/images/drillgre-icon.svg",
  "/assets/images/drillgre-logo.svg",
  "/assets/css/site-nav.css",
  "/assets/js/site-nav.js",
  "/quant/index.html",
  "/quant/question-bank.html",
  "/quant/quiz.html",
  "/quant/topic-quiz.html",
  "/quant/mock.html",
  "/vocab.html",
  "/account.html"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("drillgre-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        return (await caches.match(request)) || (await caches.match("/offline.html")) || Response.error();
      }
    })());
    return;
  }

  // Static same-origin resources use cache-first, then refresh the cache.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      return cached || Response.error();
    }
  })());
});
