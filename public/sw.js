// Service worker för offlinestöd. Registreras bara i produktionsbygget.
//
// - Sidan (/): nätet först, cachen om nätet saknas eller dröjer mer än 3 s.
// - /assets/*: cachen först. Filnamnen innehåller en hash och ändras aldrig.
// - /api/catalog: rörs inte. Katalogen ligger i IndexedDB (se src/search/catalog-cache.ts).
// - Posters: rörs inte. Bild-CDN:erna har ett års cache-control, så webbläsarens
//   HTTP-cache sparar dem redan, och SVT:s bilder saknar CORS och skulle bli
//   opaka svar som tar upp onödigt stor lagringskvot.

const VERSION = "v1";
const PAGE_CACHE = `page-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const MAX_ASSETS = 60;
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGE_CACHE);
      await cache.add(new Request("/", { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGE_CACHE, ASSET_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

// Sidan skickar de /assets/-filer den redan har laddat, så att de cachas
// även om de hämtades innan service workern tog över.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-assets") return;
  const urls = event.data.urls.filter((url) => new URL(url).pathname.startsWith("/assets/"));
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      for (const url of urls) {
        if (!(await cache.match(url))) await cache.add(url).catch(() => {});
      }
      await trim(cache);
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirstAsset(request));
  }
});

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put("/", response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));

  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch {
    // Offline: fall igenom till cachen.
  }
  const cached = await cache.match("/");
  return cached ?? network;
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

// Gamla assets från tidigare deployer ligger kvar tills cachen blir för stor;
// då tas de äldsta bort först.
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) {
    await cache.delete(key);
  }
}
