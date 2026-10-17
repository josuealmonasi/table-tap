import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const { effect, subscribe } = vi.hoisted(() => ({ effect: vi.fn(), subscribe: vi.fn() }));
vi.mock("react", () => ({ useEffect: effect }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: subscribe } }) }));
import ServiceWorkerRegistrar from "../ServiceWorkerRegistrar";
import { privateCacheIdentity } from "@/lib/private-cache-identity";

const session = (user = "alice", sessionId = "session-a", expires = Math.floor(Date.now() / 1000) + 3600) => ({
  user: { id: user }, expires_at: expires,
  access_token: `header.${btoa(JSON.stringify({ session_id: sessionId, exp: expires }))}.signature`,
}) as Session;
let authChange: (event: string, value: Session | null) => void;
let controlChange: () => void;
const postMessage = vi.fn();
const unsubscribe = vi.fn();
const removeEventListener = vi.fn();
const register = vi.fn();
const mount = (identity = privateCacheIdentity(session(), "restaurant-a", "owner")) => {
  ServiceWorkerRegistrar({ identity });
  return effect.mock.calls[0][0]() as () => void;
};
beforeEach(() => {
  vi.clearAllMocks();
  // Labels are counted to the minute: pin the clock so two reads agree.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T12:00:30Z"));
  register.mockResolvedValue({});
  subscribe.mockImplementation(callback => {
    authChange = callback;
    return { data: { subscription: { unsubscribe } } };
  });
  vi.stubGlobal("navigator", { serviceWorker: {
    controller: { postMessage }, register, ready: Promise.resolve({}), removeEventListener,
    addEventListener: (_name: string, listener: () => void) => { controlChange = listener; },
  } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("auth and the worker agree about the private render", () => {
  it("does not mistake pending auth for sign-out when a worker takes control", () => {
    mount();
    controlChange();
    expect(postMessage).not.toHaveBeenCalled();
  });
  it("clears on sign-out and a different user, even outside the dashboard", () => {
    mount();
    authChange("INITIAL_SESSION", session());
    expect(postMessage).toHaveBeenLastCalledWith({ type: "IDENTITY", identity: privateCacheIdentity(session(), "restaurant-a", "owner"), retire: true });
    authChange("SIGNED_OUT", null);
    expect(postMessage).toHaveBeenLastCalledWith({ type: "IDENTITY", identity: null, retire: true });
    authChange("SIGNED_IN", session("bob", "session-b"));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "IDENTITY", identity: null, retire: true });
  });

  it("clears if the same user signs in with a new auth session", () => {
    mount();
    authChange("SIGNED_IN", session("alice", "new-session"));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "IDENTITY", identity: null, retire: true });
  });

  it("keeps a refreshed token bound to its restaurant and role", () => {
    mount();
    const refreshed = session("alice", "session-a", Math.floor(Date.now() / 1000) + 7200);
    authChange("TOKEN_REFRESHED", refreshed);
    controlChange();
    expect(postMessage).toHaveBeenLastCalledWith({ type: "IDENTITY", identity: privateCacheIdentity(refreshed, "restaurant-a", "owner"), retire: true });
  });

  it("never registers on a public page but still clears an existing controller", () => {
    mount(null);
    authChange("INITIAL_SESSION", null);
    expect(register).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: "IDENTITY", identity: null, retire: true });
  });

  it("unsubscribes auth and controller listeners on unmount", () => {
    const cleanup = mount();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith("controllerchange", controlChange);
  });

  it("refuses expired, malformed or missing session labels", () => {
    expect(privateCacheIdentity(null, "restaurant-a", "owner")).toBeNull();
    // A live session opens a service-long window, not the token's hour.
    const until = Number(privateCacheIdentity(session(), "restaurant-a", "owner")?.split(":")[4]);
    expect(until * 1000 - Date.now()).toBeGreaterThan(11 * 3600_000);
    expect(privateCacheIdentity(session("alice", "session-a", 1), "restaurant-a", "owner")).toBeNull();
    expect(privateCacheIdentity({ ...session(), access_token: "broken" }, "restaurant-a", "owner")).toBeNull();
    expect(privateCacheIdentity(session(), "restaurant-a\" bad", "owner")).toBeNull();
  });

  it("clears an expired token without retiring an auth session that may refresh", () => {
    mount();
    authChange("INITIAL_SESSION", session("alice", "session-a", 1));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "IDENTITY", identity: null, retire: false });
  });
});
