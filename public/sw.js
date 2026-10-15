// ============================================================================
// The kitchen board and the till survive a dropped connection.
//
// Every dashboard page is rendered per request, so losing the wifi mid-service
// used to blank the screens a restaurant works from. This keeps the last board
// and the last till that loaded, and serves them when the network does not
// answer.
//
// TWO pages are cached, deliberately. /dashboard/orders carries tickets.
// /dashboard/pos carries the menu the till sells from — with no connection it
// keeps taking cash and own-terminal sales, holding them on the device until
// they can be sent (see src/lib/offline-sales.ts). Neither page holds a bill:
// a stale bills screen showing a paid table as still owing is how the same
// money gets collected twice, so nothing under /dashboard/bills, and no API
// response at all, is ever stored here.
//
// The scripts and styles those pages need are stored too: Next names each one
// after its contents, so a stored file can never be an old version of a new
// one, and without them a stored page is HTML that cannot run.
//
// The cache holds authenticated pages, so it is dropped on sign-out — see the
// CLEAR message below. It is also versioned: bumping VERSION discards
// everything a previous deploy stored.
// ============================================================================

const VERSION = "tt-v2";
const PAGES = ["/dashboard/orders", "/dashboard/pos"];
const ASSETS = "/_next/static/";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter(n => n !== VERSION).map(n => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** Sign-out cannot leave a signed-in page on the disk. */
self.addEventListener("message", event => {
  if (event.data === "CLEAR") {
    event.waitUntil(caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))));
  }
});

/** A plain page load of the board or the till, and nothing else. */
function pageOf(request) {
  if (request.method !== "GET" || request.mode !== "navigate") return null;
  const path = new URL(request.url).pathname;
  return PAGES.includes(path) ? path : null;
}

/** One of Next's own content-named scripts or styles. */
function isAsset(request) {
  return request.method === "GET" && new URL(request.url).pathname.startsWith(ASSETS);
}

self.addEventListener("fetch", event => {
  const page = pageOf(event.request);
  if (page) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(event.request);
          if (fresh.ok && !fresh.redirected) {
            const cache = await caches.open(VERSION);
            await cache.put(page, fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match(page);
          if (cached) {
            const headers = new Headers(cached.headers);
            headers.set("x-tt-offline", "1");
            return new Response(await cached.blob(), {
              status: cached.status,
              statusText: cached.statusText,
              headers,
            });
          }
          throw new Error("offline and nothing cached");
        }
      })(),
    );
    return;
  }

  if (isAsset(event.request)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request.url);
        if (cached) return cached;
        const fresh = await fetch(event.request);
        if (fresh.ok) {
          const cache = await caches.open(VERSION);
          await cache.put(event.request.url, fresh.clone());
        }
        return fresh;
      })(),
    );
  }
});
