import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * The worker, run rather than read.
 *
 * It cannot be exercised in the preview browser — service workers do not
 * register there at all, a one-line worker fails the same way — so the choices
 * that matter are made against a stand-in global scope here: what it caches,
 * what it refuses to cache, and what it does when the network does not answer.
 *
 * These are the rules a stale screen would break, and a stale screen showing a
 * paid table as still owing is how the same money gets collected twice.
 */
type Handler = (event: Record<string, unknown>) => void;

function loadWorker(): { handlers: Map<string, Handler>; caches: Map<string, Map<string, Response>> } {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();

  const cacheApi = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return { put: async (key: string, res: Response) => void store.set(key, res) };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (key: string) => {
      for (const store of stores.values()) if (store.has(key)) return store.get(key);
      return undefined;
    },
  };

  const scope = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    caches: cacheApi,
  };

  const source = readFileSync("public/sw.js", "utf8");
  // Dispatch through globalThis at CALL time, not load time. Capturing the
  // function by value handed the worker the real fetch, so every stub in these
  // tests went unused and two of them passed for the wrong reason.
  const liveFetch = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args);
  new Function("self", "caches", "fetch", "Response", "Headers", "URL", source)(
    scope,
    cacheApi,
    liveFetch,
    Response,
    Headers,
    URL,
  );
  return { handlers, caches: stores };
}

/** A page navigation, which is the only thing the worker may touch. */
const navigation = (url: string) => ({ url, method: "GET", mode: "navigate" as const });

describe("the worker that keeps the kitchen board through a drop", () => {
  it("takes over only page loads of the board", () => {
    const { handlers } = loadWorker();
    const seen: string[] = [];
    const fetchEvent = (request: ReturnType<typeof navigation>) => ({
      request,
      respondWith: (p: Promise<Response>) => seen.push(request.url) && void p.catch(() => {}),
    });

    handlers.get("fetch")!(fetchEvent(navigation("https://x.dev/dashboard/orders")));
    expect(seen, "the board is the page it exists for").toEqual([
      "https://x.dev/dashboard/orders",
    ]);
  });

  it("never touches the bills screen", () => {
    // The one rule that is about money: a cached bill showing a paid table as
    // still owing is how the same money gets collected twice.
    const { handlers } = loadWorker();
    let claimed = false;
    handlers.get("fetch")!({
      request: navigation("https://x.dev/dashboard/bills"),
      respondWith: () => (claimed = true),
    });
    expect(claimed).toBe(false);
  });

  it("never touches an API call", () => {
    const { handlers } = loadWorker();
    let claimed = false;
    handlers.get("fetch")!({
      request: { url: "https://x.dev/api/orders", method: "PATCH", mode: "cors" },
      respondWith: () => (claimed = true),
    });
    expect(claimed).toBe(false);
  });

  it("throws away every cache when the session ends", async () => {
    const { handlers, caches: stores } = loadWorker();
    stores.set("tt-v1", new Map([["/dashboard/orders", new Response("board")]]));

    const waits: Promise<unknown>[] = [];
    handlers.get("message")!({ data: "CLEAR", waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);

    expect(stores.size, "a signed-in board must not outlive the session").toBe(0);
  });

  it("ignores a message that is not the clear instruction", async () => {
    const { handlers, caches: stores } = loadWorker();
    stores.set("tt-v1", new Map());
    handlers.get("message")!({ data: "something else", waitUntil: () => undefined });
    expect(stores.size).toBe(1);
  });

  it("stores a board it fetched, and serves it when the network is gone", async () => {
    const { handlers, caches: stores } = loadWorker();
    const responses: Promise<Response>[] = [];
    const request = navigation("https://x.dev/dashboard/orders");

    // First load: the network answers, so the board is kept.
    vi.stubGlobal("fetch", async () => new Response("<board/>", { status: 200 }));
    handlers.get("fetch")!({ request, respondWith: (p: Promise<Response>) => responses.push(p) });
    await responses[0];
    expect(stores.get("tt-v1")?.has("/dashboard/orders")).toBe(true);

    // Then the connection drops.
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    handlers.get("fetch")!({ request, respondWith: (p: Promise<Response>) => responses.push(p) });
    const served = await responses[1];
    expect(await served.text()).toBe("<board/>");
    expect(served.headers.get("x-tt-offline"), "the page must know it is reading history").toBe("1");
    vi.unstubAllGlobals();
  });

  it("does not store a redirect, which is the session ending", async () => {
    const { handlers, caches: stores } = loadWorker();
    const responses: Promise<Response>[] = [];
    const redirected = new Response("login", { status: 200 });
    Object.defineProperty(redirected, "redirected", { value: true });

    vi.stubGlobal("fetch", async () => redirected);
    handlers.get("fetch")!({
      request: navigation("https://x.dev/dashboard/orders"),
      respondWith: (p: Promise<Response>) => responses.push(p),
    });
    await responses[0];
    expect(
      stores.get("tt-v1")?.has("/dashboard/orders") ?? false,
      "caching the login page would show it to somebody who is signed in",
    ).toBe(false);
    vi.unstubAllGlobals();
  });
});
