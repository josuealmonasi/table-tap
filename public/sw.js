// Only the board and till survive a drop. Bills and APIs must stay live:
// an old bill can collect the same money twice.
const VERSION = "tt-v3";
const ASSETS = `${VERSION}-assets`;
const META = `${VERSION}-session`;
const PRIVATE = `${VERSION}-private-`;
const KEY = "/__tt_private_session";
const PAGES = ["/dashboard/orders", "/dashboard/pos"];
let identity = null;
let retired = [];
let loaded = false;
let generation = 0;
let pending = Promise.resolve();

// Deletion and writes share one queue. CLEAR acknowledges only after both,
// including a put that had already started when sign-out arrived.
function serial(task) {
  const result = pending.then(task);
  pending = result.catch(() => {});
  return result;
}
function owner(value) {
  return value?.split(":").slice(0, 4).join(":");
}
function valid(value) {
  return typeof value === "string" && /^[\w-]+:[\w-]+:[\w-]+:[\w-]+:\d+$/.test(value)
    && Number(value.split(":")[4]) * 1000 > Date.now();
}
async function load() {
  if (loaded) return;
  const stored = await (await caches.open(META)).match(KEY);
  const state = stored ? await stored.json() : {};
  identity = state.identity ?? null;
  retired = state.retired ?? [];
  loaded = true;
}
async function persist() {
  await (await caches.open(META)).put(KEY, new Response(JSON.stringify({ identity, retired })));
}
async function change(next, retire = true) {
  await load();
  if (retired.includes(owner(next))) next = null;
  if (!next || owner(next) !== owner(identity)) {
    generation++;
    if (retire && identity && !retired.includes(owner(identity))) retired.push(owner(identity));
    identity = null;
    // Keep the retirement across restarts. A request can start after CLEAR
    // while Supabase is still finishing sign-out with the old cookie.
    await persist();
    const names = await caches.keys();
    // Held sales are money already taken, and are never part of this cache.
    await Promise.all(names.filter(n => n.startsWith("tt-v") && n !== ASSETS && n !== META).map(n => caches.delete(n)));
  }
  identity = next;
  if (next) await persist();
}
function clear(retire = true) {
  generation++;
  return serial(() => change(null, retire));
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil(serial(async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith("tt-v") && n !== ASSETS && n !== META
      && !n.startsWith(PRIVATE)).map(n => caches.delete(n)));
    await self.clients.claim();
  }));
});
self.addEventListener("message", event => {
  let work;
  if (event.data === "CLEAR") work = clear();
  if (event.data?.type === "IDENTITY") {
    generation++;
    work = serial(async () => {
      await load();
      const next = event.data.identity;
      // Only a fresh server page may establish an owner. An old open tab
      // cannot restore its identity after another tab signed out.
      await change(valid(next) && owner(next) === owner(identity) ? next : null, event.data.retire !== false);
    });
  }
  if (work) event.waitUntil(work.then(
    () => event.ports?.[0]?.postMessage("CLEARED"),
    () => event.ports?.[0]?.postMessage("FAILED"),
  ));
});

async function navigate(request, page, started) {
  let fresh;
  try {
    fresh = await fetch(request);
  } catch (error) {
    if (!page) throw error;
    return serial(async () => {
      await load();
      if (!valid(identity)) await change(null, false);
      if (!identity || started !== generation) throw new Error("offline and no session cache");
      // Never search across caches: another person's pathname is identical.
      const cached = await (await caches.open(PRIVATE + owner(identity))).match(page);
      if (!cached) throw new Error("offline and nothing cached");
      const body = await cached.blob();
      if (started !== generation || !valid(identity)) throw new Error("offline and session ended");
      const headers = new Headers(cached.headers);
      headers.set("x-tt-offline", "1");
      return new Response(body, { status: cached.status, statusText: cached.statusText, headers });
    });
  }
  const path = new URL(request.url).pathname;
  try {
    const redirected = fresh.redirected || fresh.type === "opaqueredirect" || (fresh.status >= 300 && fresh.status < 400);
    const target = fresh.headers.get("location") || fresh.url || request.url;
    const ended = fresh.status === 401 || path === "/login" || (redirected && new URL(target, request.url).pathname === "/login");
    if (ended || redirected) {
      // A role redirect clears history too, but may cache the authorized
      // destination under the same session. Only login/401 retires it.
      await clear(ended);
    } else if (page && fresh.ok) {
      // The label comes from the same authorized server render as the HTML.
      // A browser message alone must never label a different user's response.
      const html = await fresh.clone().text();
      const next = html.match(/<meta name="tt-private-cache" content="([\w:-]+)"\s*\/?\s*>/)?.[1];
      await serial(async () => {
        if (started !== generation) return;
        await change(valid(next) ? next : null);
        if (identity) await (await caches.open(PRIVATE + owner(identity))).put(page, fresh.clone());
      });
    }
  } catch {
    // A full disk must not break a live till. Refuse offline reads until a
    // fresh render can establish an owner again.
    identity = null;
    generation++;
  }
  return fresh;
}
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const path = new URL(request.url).pathname;
  if (request.mode === "navigate") {
    event.respondWith(navigate(request, PAGES.includes(path) ? path : null, generation));
  } else if (path.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const cached = await cache.match(request.url);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) await cache.put(request.url, fresh.clone());
      return fresh;
    })());
  }
});
