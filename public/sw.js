// ============================================================================
// The kitchen board survives a dropped connection.
//
// Every dashboard page is rendered per request, so losing the wifi mid-service
// used to blank the screen the pass works from. This keeps the last board that
// loaded and serves it when the network does not answer.
//
// ONE page is cached, deliberately: /dashboard/orders. It carries tickets, not
// money. A stale bills screen showing a paid table as still owing is how the
// same money gets collected twice, so nothing under /dashboard/bills, and no
// API response at all, is ever stored here.
//
// The cache holds an authenticated page, so it is dropped on sign-out — see
// the CLEAR message below. It is also versioned: bumping VERSION discards
// everything a previous deploy stored.
// ============================================================================

const VERSION = "tt-v1";
const BOARD = "/dashboard/orders";

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

/** Only the board itself, and only a plain page load of it. */
function isBoard(request) {
  if (request.method !== "GET" || request.mode !== "navigate") return false;
  return new URL(request.url).pathname === BOARD;
}

self.addEventListener("fetch", event => {
  if (!isBoard(event.request)) return;

  // Network first, always: the board is live data and a cached one is a
  // fallback, never a shortcut. Next's own RSC payloads carry a different
  // Accept header and are left alone.
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(event.request);
        // A redirect to /login is the session ending; storing it would serve
        // the login page to somebody who is signed in on the next drop.
        if (fresh.ok && !fresh.redirected) {
          const cache = await caches.open(VERSION);
          await cache.put(BOARD, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match(BOARD);
        if (cached) {
          // Marked so the page knows it is reading history, not the kitchen.
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
});
