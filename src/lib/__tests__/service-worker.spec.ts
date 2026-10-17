import { afterEach, describe, expect, it, vi } from "vitest";
import { label, loadWorker, navigation, offline, page } from "./service-worker-harness";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

// Preview browsers cannot register workers. Execute the real sw.js instead.
describe("private pages belong to one live session", () => {
  it("never serves the previous board after a login redirect", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page("owner's MX$1,200 board"));
    await worker.request();
    const login = new Response("login");
    Object.defineProperty(login, "redirected", { value: true });
    Object.defineProperty(login, "url", { value: "https://x.dev/login" });
    vi.stubGlobal("fetch", async () => login);
    await worker.request();
    offline();
    await expect(worker.request()).rejects.toThrow("offline");
  });

  it.each(["/dashboard/orders", "/dashboard/pos"])("keeps %s for its session through a drop and worker restart", async path => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page("private page"));
    await worker.request(navigation(path));
    expect(worker.stores.get(`tt-v3-private-${label().split(":").slice(0, 4).join(":")}`)?.has(path)).toBe(true);
    offline();
    const restarted = loadWorker(worker.stores);
    const response = await restarted.request(navigation(path));
    expect(await response?.text()).toContain("private page");
    expect(response?.headers.get("x-tt-offline")).toBe("1");
  });

  it.each([
    ["bob", "session-b", "restaurant-a", "owner"],
    ["alice", "session-b", "restaurant-a", "owner"],
    ["alice", "session-a", "restaurant-b", "owner"],
    ["alice", "session-a", "restaurant-a", "cashier"],
  ])("retires pages when identity changes to %s / %s / %s / %s", async (user, session, restaurant, role) => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    await worker.message({ type: "IDENTITY", identity: label(user, session, restaurant, role) });
    offline();
    await expect(worker.request()).rejects.toThrow("offline");
  });

  it("replaces the previous owner's pages with a fresh server identity", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page("alice"));
    await worker.request();
    vi.stubGlobal("fetch", async () => page("bob", label("bob", "session-b")));
    await worker.request(navigation("/dashboard/pos"));
    offline();
    await expect(worker.request()).rejects.toThrow("offline");
    expect(await (await worker.request(navigation("/dashboard/pos")))?.text()).toContain("bob");
    expect([...worker.stores.keys()].some(n => n.includes("alice"))).toBe(false);
  });

  it("expires a saved session without needing an open tab", async () => {
    vi.useFakeTimers();
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    vi.setSystemTime(Date.now() + 12 * 3600_000 + 61_000);
    offline();
    await expect(loadWorker(worker.stores).request()).rejects.toThrow("offline");
  });

  it.each([401, 302])("clears old pages when any navigation answers %s", async status => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    vi.stubGlobal("fetch", async () => new Response("login", { status, headers: { location: "/login" } }));
    await worker.request(navigation("/dashboard/bills"));
    offline();
    await expect(worker.request()).rejects.toThrow("offline");
  });

  it("can cache an authorized destination after a role redirect in the same session", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 302, headers: { location: "/dashboard/orders" } }));
    await worker.request(navigation("/dashboard/pos"));
    vi.stubGlobal("fetch", async () => page("authorized board"));
    await worker.request();
    offline();
    expect(await (await worker.request())?.text()).toContain("authorized board");
  });

  it("clears on direct login navigation and missing server identity", async () => {
    for (const path of ["/login", "/dashboard/orders"]) {
      const worker = loadWorker();
      vi.stubGlobal("fetch", async () => page());
      await worker.request();
      vi.stubGlobal("fetch", async () => new Response("public page"));
      await worker.request(navigation(path));
      offline();
      await expect(worker.request()).rejects.toThrow("offline");
    }
  });

  it("never caches bills, API calls, or pages without a server identity", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => new Response("public page"));
    expect(worker.request({ url: "https://x.dev/api/orders", method: "PATCH", mode: "cors" })).toBeUndefined();
    await worker.request(navigation("/dashboard/bills"));
    await worker.request();
    offline();
    await expect(worker.request(navigation("/dashboard/bills"))).rejects.toThrow("offline");
    await expect(worker.request()).rejects.toThrow("offline");
  });

  it("keeps the board on transient server failures, without caching the error", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page("board"));
    await worker.request();
    vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503 }));
    expect((await worker.request())?.status).toBe(503);
    offline();
    expect(await (await worker.request())?.text()).toContain("board");
  });

  it("keeps static scripts and held sales when clearing private pages", async () => {
    const worker = loadWorker();
    worker.stores.set("tt-offline-sales", new Map([["sale", new Response("MX$100")]]));
    worker.stores.set("tt-v2", new Map([["/dashboard/orders", new Response("legacy")]]));
    const asset = { url: "https://x.dev/_next/static/chunks/app-123.js", method: "GET", mode: "no-cors" };
    vi.stubGlobal("fetch", async () => new Response("script"));
    await worker.request(asset);
    const ack = await worker.message("CLEAR");
    expect(ack).toHaveBeenCalledWith("CLEARED");
    offline();
    expect(await (await worker.request(asset))?.text()).toBe("script");
    expect(await worker.stores.get("tt-offline-sales")?.get("sale")?.text()).toBe("MX$100");
    expect(worker.stores.has("tt-v2")).toBe(false);
  });

  it("activation drops tt-v2 but preserves current sessions and held sales", async () => {
    const worker = loadWorker();
    worker.stores.set("tt-v2", new Map());
    worker.stores.set("tt-offline-sales", new Map());
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    await worker.activate();
    expect(worker.stores.has("tt-v2")).toBe(false);
    expect(worker.stores.has("tt-offline-sales")).toBe(true);
    offline();
    expect(await (await loadWorker(worker.stores).request())?.text()).toContain("board");
  });
});
