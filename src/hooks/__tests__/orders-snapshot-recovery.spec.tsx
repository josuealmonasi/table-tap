// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardOrder, KitchenTicket } from "@/lib/kitchen-ticket";
import type { OrderStatus } from "@/lib/types";

const state = vi.hoisted(() => ({ receive: vi.fn<(payload: { new: BoardOrder; eventType: string; commit_timestamp?: string }) => void>(),
  t: (key: string) => key, toast: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => state.t }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/hooks/useBadges", () => ({ badgesChanged: vi.fn() }));
vi.mock("@/hooks/useOnline", () => ({ useOnline: () => ({ online: false, markOffline: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const channel = { on: (_kind: unknown, _opts: unknown, receive: typeof state.receive) => {
    state.receive = receive; return channel;
  }, subscribe: () => channel };
  return { auth: { getSession: async () => ({ data: { session: null } }) },
    channel: () => channel, removeChannel: vi.fn() };
} }));
import { useRestaurantOrders } from "../useRestaurantOrders";
let hook: ReturnType<typeof useRestaurantOrders>;
let root: Root;
let container: HTMLDivElement;
const row = (id: string, status: OrderStatus = "received", stations_ready: string[] = []): BoardOrder => ({
  id, restaurant_id: "r1", status, stations_ready, items: [], created_at: "2026-10-27T10:00:00Z",
  code: id, table_label: "1", note: null,
} satisfies KitchenTicket);
function Harness({ orders, readAt, kitchen }: { orders: BoardOrder[]; readAt: number; kitchen: boolean }) {
  hook = useRestaurantOrders("r1", orders, kitchen, readAt);
  return null;
}
async function render(orders: BoardOrder[], readAt: number, kitchen = false) {
  await act(async () => root.render(<Harness orders={orders} readAt={readAt} kitchen={kitchen} />));
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(200);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  localStorage.clear(); container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("recovers a missed insert from a refreshed snapshot (kitchen=%s)", async kitchen => {
  await render([row("a")], 100, kitchen);
  await render([row("a"), row("missed")], 300, kitchen);
  expect(hook.orders.map(o => o.id)).toContain("missed");
});
it.each([false, true])("recovers a missed station and stage change (kitchen=%s)", async kitchen => {
  await render([row("a")], 100, kitchen);
  await render([row("a", "preparing", ["bar"])], 300, kitchen);
  expect(hook.orders[0]).toMatchObject({ status: "preparing", stations_ready: ["bar"] });
});
it("keeps realtime inserts and station changes received after the snapshot read", async () => {
  await render([row("a")], 100);
  await act(async () => {
    state.receive({ eventType: "INSERT", new: row("b") });
    state.receive({ eventType: "UPDATE", new: row("a", "preparing", ["bar"]) });
  });
  await render([row("a")], 150);
  expect(hook.orders.map(o => o.id)).toContain("b");
  expect(hook.orders.find(o => o.id === "a")).toMatchObject({ stations_ready: ["bar"] });
  // A later authoritative read must be allowed to correct that same row.
  await render([row("a", "ready", ["bar", "kitchen"]), row("b")], 300);
  expect(hook.orders.find(o => o.id === "a")?.status).toBe("ready");
});
it("removes missed completions without reviving rows from an older response", async () => {
  await render([row("a")], 100);
  await render([], 300);
  expect(hook.orders).toEqual([]);
  await render([row("a")], 150);
  expect(hook.orders).toEqual([]);
});
it("keeps an in-flight optimistic move across a newer snapshot", async () => {
  let finish!: (res: { ok: boolean }) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  await render([row("a")], 100);
  let move!: Promise<void>;
  await act(async () => { move = hook.updateStatus("a", "preparing"); });
  await render([row("a")], 300);
  expect(hook.orders[0].status).toBe("preparing");
  await act(async () => { finish({ ok: true }); await move; });
});
it("reapplies persisted queued moves to refreshed tickets", async () => {
  localStorage.setItem("tt-offline-queue", JSON.stringify([{ id: "a", from: "received", to: "preparing", at: 1 }]));
  await render([row("a")], 100);
  await render([row("a")], 300);
  expect(hook.pending).toBeGreaterThan(0);
  expect(hook.orders[0].status).toBe("preparing");
});

it("protects overlapping moves until both requests finish", async () => {
  const replies: ((res: { ok: boolean }) => void)[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { replies.push(resolve); })));
  await render([row("a")], 100);
  let first!: Promise<void>; let second!: Promise<void>;
  await act(async () => { first = hook.updateStatus("a", "preparing"); });
  await act(async () => { second = hook.updateStatus("a", "ready"); });
  await act(async () => { replies[0]({ ok: true }); await first; });
  await render([row("a")], 300);
  expect(hook.orders[0].status).toBe("ready");
  await act(async () => { replies[1]({ ok: true }); await second; });
});

it("compares realtime server timestamps even when the tablet clock is behind", async () => {
  vi.mocked(Date.now).mockReturnValue(-10_000);
  await render([row("a")], 100);
  await act(async () => state.receive({ eventType: "UPDATE", new: row("a", "preparing"),
    commit_timestamp: new Date(200).toISOString() }));
  await render([row("a")], 150);
  expect(hook.orders[0].status).toBe("preparing");
});
it("keeps a confirmed move using the reply's server date when the tablet clock is behind", async () => {
  vi.mocked(Date.now).mockReturnValue(-10_000);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {
    headers: { Date: new Date(2000).toUTCString() },
  })));
  await render([row("a")], 1000);
  await act(async () => hook.updateStatus("a", "preparing"));
  await render([row("a")], 1500);
  expect(hook.orders[0].status).toBe("preparing");
  await render([row("a", "ready")], 4000);
  expect(hook.orders[0].status).toBe("ready");
});
