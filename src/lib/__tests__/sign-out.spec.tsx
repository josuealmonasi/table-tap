import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signOut, readHeld } = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ error: null as Error | null })),
  readHeld: vi.fn((): unknown[] => []),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));
vi.mock("@/lib/offline-sales", () => ({ readHeld }));
import { signOutEverywhere } from "@/lib/sign-out";

const assign = vi.fn();
let postMessage: ReturnType<typeof vi.fn>;
let acknowledge: (data: string) => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  readHeld.mockReturnValue([]);
  signOut.mockResolvedValue({ error: null });
  vi.stubGlobal("window", { location: { assign } });
  postMessage = vi.fn();
  const worker = { postMessage };
  vi.stubGlobal("navigator", {
    serviceWorker: { controller: worker, getRegistration: async () => ({ active: worker }) },
  });
  vi.stubGlobal("MessageChannel", class {
    port1 = { onmessage: null as null | ((event: { data: string }) => void), close: vi.fn() };
    port2 = { close: vi.fn() };
    constructor() { acknowledge = data => this.port1.onmessage?.({ data }); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const dispatched = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("sign-out waits for the worker to clear disk, but never on it", () => {
  it("does not end auth or redirect before the CLEAR acknowledgement", async () => {
    const signingOut = signOutEverywhere();
    await dispatched();
    expect(postMessage).toHaveBeenCalledWith("CLEAR", [expect.anything()]);
    expect(signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    acknowledge("CLEARED");
    await signingOut;
    expect(signOut).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  // A worker that cannot clear must never keep somebody signed in: the
  // navigation to /login retires their pages anyway.
  it.each(["FAILED", "unexpected"])("still signs out when clearing answers %s", async answer => {
    const signingOut = signOutEverywhere();
    await dispatched();
    acknowledge(answer);
    await signingOut;
    expect(signOut).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("still signs out when the worker never acknowledges", async () => {
    const signingOut = signOutEverywhere();
    await dispatched();
    expect(signOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    await signingOut;
    expect(signOut).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("does not redirect if Supabase sign-out fails", async () => {
    signOut.mockResolvedValue({ error: new Error("auth unavailable") });
    const signingOut = signOutEverywhere();
    const rejected = expect(signingOut).rejects.toThrow("auth unavailable");
    await dispatched();
    acknowledge("CLEARED");
    await rejected;
    expect(assign).not.toHaveBeenCalled();
  });

  it("protects held offline sales and never starts clearing while any remain", async () => {
    readHeld.mockReturnValue([{ ref: "held-sale" }]);
    const blocked = vi.fn();
    await signOutEverywhere(blocked);
    expect(blocked).toHaveBeenCalledWith(1);
    expect(postMessage).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("works without service-worker support", async () => {
    vi.stubGlobal("navigator", {});
    await signOutEverywhere();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("removes private disk entries left by an unregistered worker", async () => {
    Object.assign(navigator.serviceWorker, { controller: null, getRegistration: async () => undefined });
    const remove = vi.fn();
    vi.stubGlobal("caches", { keys: async () => ["tt-v2", "tt-v3-session", "tt-v3-private-alice", "tt-v3-assets", "tt-offline-sales"], delete: remove });
    await signOutEverywhere();
    expect(remove.mock.calls.map(([name]) => name)).toEqual(["tt-v2", "tt-v3-session", "tt-v3-private-alice"]);
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("clears through the active registration when this tab has no controller", async () => {
    Object.assign(navigator.serviceWorker, { controller: null });
    const signingOut = signOutEverywhere();
    await dispatched();
    acknowledge("CLEARED");
    await signingOut;
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
