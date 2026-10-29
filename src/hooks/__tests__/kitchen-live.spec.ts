import { beforeEach, expect, it, vi } from "vitest";
import type { BoardOrder, BoardRequest } from "@/lib/kitchen-ticket";

interface Change { eventType: string; new: unknown }
const state = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[], values: [] as unknown[],
  listeners: [] as { table: string; event: string; filter: string; receive: (p: Change) => void }[],
  auth: vi.fn(), remove: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (fn: () => void) => state.effects.push(fn),
  useCallback: (fn: unknown) => fn,
  useState: <T>(initial: T) => {
    const index = state.values.push(initial) - 1;
    return [initial, (next: T | ((v: T) => T)) => {
      state.values[index] = typeof next === "function" ? (next as (v: T) => T)(state.values[index] as T) : next;
    }];
  },
}));
vi.mock("@/hooks/useOnline", () => ({ useOnline: () => ({ online: false }) }));
vi.mock("@/hooks/useBadges", () => ({ badgesChanged: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const channel = {
    on: (_kind: string, options: { table: string; event: string; filter: string }, receive: (p: Change) => void) => {
      state.listeners.push({ ...options, receive }); return channel;
    }, subscribe: () => channel,
  };
  return { auth: { getSession: async () => ({ data: { session: { access_token: "kitchen-session" } } }) },
    realtime: { setAuth: state.auth }, channel: () => channel, removeChannel: state.remove };
} }));
const { useRestaurantOrders } = await import("@/hooks/useRestaurantOrders");
const { useServiceRequests } = await import("@/hooks/useServiceRequests");
beforeEach(() => {
  state.effects.length = 0; state.values.length = 0; state.listeners.length = 0;
  vi.clearAllMocks();
});
it.each([true, false])("keeps status and station updates live, kitchen=%s", async kitchen => {
  useRestaurantOrders("r1", [], kitchen);
  const cleanup = state.effects[1]();
  await Promise.resolve();
  const feed = state.listeners[0];
  expect(feed).toMatchObject({ table: kitchen ? "kitchen_tickets" : "orders", filter: "restaurant_id=eq.r1" });
  expect(state.auth).toHaveBeenCalledWith("kitchen-session");
  const ticket = { id: "ticket", code: "1234", status: "received", items: [], stations_ready: [] };
  feed.receive({ eventType: "INSERT", new: ticket });
  expect(state.values[0]).toEqual([ticket]);
  feed.receive({ eventType: "UPDATE", new: { ...ticket, status: "ready", stations_ready: ["bar", "kitchen"] } });
  expect((state.values[0] as BoardOrder[])[0].stations_ready).toEqual(["bar", "kitchen"]);
  feed.receive({ eventType: "UPDATE", new: { ...ticket, status: "completed" } });
  expect((state.values[0] as BoardOrder[])[0].status).toBe("completed");
  if (typeof cleanup === "function") cleanup();
  expect(state.remove).toHaveBeenCalledOnce();
});
it("keeps kitchen calls live and removes a call answered elsewhere", async () => {
  useServiceRequests("r1", [], true);
  const cleanup = state.effects[2]();
  await Promise.resolve();
  expect(state.listeners.every(l => l.table === "kitchen_requests")).toBe(true);
  const call = { id: "call", kind: "bill", table_label: "8", status: "open" };
  state.listeners[0].receive({ eventType: "INSERT", new: call });
  expect(state.values[0]).toEqual([call]);
  expect((state.values[0] as BoardRequest[])[0]).not.toHaveProperty("table_id");
  state.listeners[1].receive({ eventType: "UPDATE", new: { ...call, status: "done" } });
  expect(state.values[0]).toEqual([]);
  if (typeof cleanup === "function") cleanup();
  expect(state.remove).toHaveBeenCalledOnce();
});
