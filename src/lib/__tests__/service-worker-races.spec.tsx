import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred, label, loadWorker, navigation, offline, page } from "./service-worker-harness";

afterEach(() => vi.unstubAllGlobals());

describe("a cleared private cache stays cleared", () => {
  it("cannot re-cache the ended session while auth sign-out is still finishing", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    await worker.message("CLEAR");
    const restarted = loadWorker(worker.stores);
    await restarted.request();
    offline();
    await expect(restarted.request()).rejects.toThrow("offline");
  });
  it("reports a failed deletion and leaves no owner for a restarted worker", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    worker.hooks.delete = async () => { throw new Error("disk refused deletion"); };
    expect(await worker.message("CLEAR")).toHaveBeenCalledWith("FAILED");
    offline();
    await expect(loadWorker(worker.stores).request()).rejects.toThrow("offline");
  });

  it("returns the live till even when disk storage refuses a write", async () => {
    const worker = loadWorker();
    worker.hooks.put = async () => { throw new Error("disk full"); };
    vi.stubGlobal("fetch", async () => page("live till"));
    expect(await (await worker.request(navigation("/dashboard/pos")))?.text()).toContain("live till");
    offline();
    await expect(worker.request(navigation("/dashboard/pos"))).rejects.toThrow();
  });
  it.each(["CLEAR", { type: "IDENTITY", identity: null }, { type: "IDENTITY", identity: label("bob", "session-b") }])(
    "does not let an in-flight response repopulate disk after %j", async instruction => {
      const worker = loadWorker();
      const arriving = deferred();
      vi.stubGlobal("fetch", async () => { await arriving.promise; return page("late alice"); });
      const loading = worker.request();
      const ack = await worker.message(instruction);
      expect(ack).toHaveBeenCalledWith("CLEARED");
      arriving.resolve();
      await loading;
      offline();
      await expect(loadWorker(worker.stores).request()).rejects.toThrow("offline");
    },
  );

  it("acknowledges CLEAR only after an already-started put and its deletion", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    const writing = deferred();
    const release = deferred();
    worker.hooks.put = async () => { writing.resolve(); await release.promise; };
    const loading = worker.request();
    await writing.promise;
    const ack = vi.fn();
    const clearing = worker.message("CLEAR", ack);
    await Promise.resolve();
    expect(ack).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([loading, clearing]);
    expect(ack).toHaveBeenCalledWith("CLEARED");
    expect([...worker.stores.keys()].some(n => n.includes("private"))).toBe(false);
    offline();
    await expect(loadWorker(worker.stores).request()).rejects.toThrow("offline");
  });

  it("does not serve a cached response whose disk read overlaps CLEAR", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    const reading = deferred();
    const release = deferred();
    worker.hooks.match = async () => { reading.resolve(); await release.promise; };
    offline();
    const loading = worker.request();
    const rejected = expect(loading).rejects.toThrow("offline");
    await reading.promise;
    const clearing = worker.message("CLEAR");
    release.resolve();
    await Promise.all([rejected, clearing]);
  });

  it("a late old session response cannot replace a newly cached session", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    const arriving = deferred();
    vi.stubGlobal("fetch", async () => { await arriving.promise; return page("alice late"); });
    const old = worker.request();
    vi.stubGlobal("fetch", async () => page("bob", label("bob", "session-b")));
    await worker.request(navigation("/dashboard/pos"));
    arriving.resolve();
    await old;
    offline();
    await expect(worker.request()).rejects.toThrow("offline");
    expect(await (await worker.request(navigation("/dashboard/pos")))?.text()).toContain("bob");
  });

  it("an old open tab cannot restore its session after CLEAR", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page());
    await worker.request();
    await worker.message("CLEAR");
    await worker.message({ type: "IDENTITY", identity: label() });
    offline();
    await expect(worker.request()).rejects.toThrow("offline");
  });

  it("a token refresh keeps the same session's offline till", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page("till"));
    await worker.request(navigation("/dashboard/pos"));
    const later = Math.floor(Date.now() / 1000) + 7200;
    await worker.message({ type: "IDENTITY", identity: label("alice", "session-a", "restaurant-a", "owner", later) });
    offline();
    expect(await (await loadWorker(worker.stores).request(navigation("/dashboard/pos")))?.text()).toContain("till");
  });

  it("a fresh server render can restore the same auth session after token expiry", async () => {
    const worker = loadWorker();
    vi.stubGlobal("fetch", async () => page("till"));
    await worker.request(navigation("/dashboard/pos"));
    await worker.message({ type: "IDENTITY", identity: null, retire: false });
    const later = Math.floor(Date.now() / 1000) + 7200;
    vi.stubGlobal("fetch", async () => page("refreshed till", label("alice", "session-a", "restaurant-a", "owner", later)));
    await worker.request(navigation("/dashboard/pos"));
    offline();
    expect(await (await worker.request(navigation("/dashboard/pos")))?.text()).toContain("refreshed till");
  });
});
