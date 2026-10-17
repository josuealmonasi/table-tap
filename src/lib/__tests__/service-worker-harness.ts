import { readFileSync } from "node:fs";
import { vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Handler = (event: Record<string, unknown>) => void;
export const label = (user = "alice", session = "session-a", restaurant = "restaurant-a", role = "owner", expires = Math.floor(Date.now() / 1000) + 3600) =>
  [user, session, restaurant, role, expires].join(":");
export const page = (body = "board", identity = label()) => new Response(
  renderToStaticMarkup(createElement("html", null,
    createElement("head", null, createElement("meta", { name: "tt-private-cache", content: identity })),
    createElement("body", null, body))),
);
export const navigation = (path = "/dashboard/orders") => ({ url: `https://x.dev${path}`, method: "GET", mode: "navigate" });

/** Run the worker against disk-like caches; a new scope can reuse the same disk. */
export function loadWorker(stores = new Map<string, Map<string, Response>>()) {
  const handlers = new Map<string, Handler>();
  const hooks: { put?: () => Promise<void>; match?: () => Promise<void>; delete?: () => Promise<void> } = {};
  const cacheApi = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        put: async (key: string, res: Response) => {
          await hooks.put?.();
          store.set(key, res.clone());
        },
        match: async (key: string) => {
          await hooks.match?.();
          return store.get(key)?.clone();
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => { await hooks.delete?.(); return stores.delete(name); },
    match: async (key: string) => {
      for (const store of stores.values()) if (store.has(key)) return store.get(key)?.clone();
    },
  };
  const scope = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  // Look up fetch at call time so a network stub never falls through to real IO.
  const liveFetch = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args);
  new Function("self", "caches", "fetch", "Response", "Headers", "URL", readFileSync("public/sw.js", "utf8"))(
    scope, cacheApi, liveFetch, Response, Headers, URL,
  );
  const request = (request = navigation()) => {
    let response: Promise<Response> | undefined;
    handlers.get("fetch")!({ request, respondWith: (p: Promise<Response>) => { response = p; } });
    return response;
  };
  const message = async (data: unknown, acknowledge = vi.fn()) => {
    const waits: Promise<unknown>[] = [];
    handlers.get("message")!({ data, ports: [{ postMessage: acknowledge }], waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    return acknowledge;
  };
  const activate = async () => {
    const waits: Promise<unknown>[] = [];
    handlers.get("activate")!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { stores, request, message, activate, hooks };
}
export const offline = () => vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
