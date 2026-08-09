const CACHE = "midori-kanjo-v5";
const SHELL = [
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/app-icon-192.png",
  "/app-icon-512.png",
];

function documentAssets(html) {
  const assets = new Set();
  const attribute = /\b(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attribute)) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (
        url.origin === self.location.origin &&
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.pathname.startsWith("/assets/")
      ) {
        assets.add(url.href);
      }
    } catch {
      // Ignore malformed or non-URL attributes in the rendered document.
    }
  }
  return [...assets];
}

async function fetchIntoCache(cache, request, cacheKey = request) {
  const response = await fetch(request);
  if (!response.ok) throw new Error(`Could not precache ${String(request)}`);
  await cache.put(cacheKey, response.clone());
  return response;
}

async function precacheApplicationShell() {
  const cache = await caches.open(CACHE);
  const documentResponse = await fetchIntoCache(cache, "/", "/");
  const html = await documentResponse.text();
  await Promise.all([
    ...SHELL.map((url) => fetchIntoCache(cache, url)),
    ...documentAssets(html).map((url) => fetchIntoCache(cache, url)),
  ]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheApplicationShell();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            try {
              await cache.put("/", response.clone());
            } catch {
              // A quota failure must not turn a successful online navigation
              // into an offline response.
            }
          }
          return response;
        } catch {
          return (await caches.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request);
      if (
        response.ok &&
        new URL(event.request.url).origin === self.location.origin
      ) {
        const cache = await caches.open(CACHE);
        try {
          await cache.put(event.request, response.clone());
        } catch {
          // Serve the network response even if the browser cannot grow cache.
        }
      }
      return response;
    })(),
  );
});
