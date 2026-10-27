// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardOrder, KitchenTicket } from "@/lib/kitchen-ticket";
import type { OrderStatus } from "@/lib/types";
const state = vi.hoisted(() => ({ online: false, t: (key: string) => key, toast: vi.fn(),
  receive: vi.fn<(payload: { new: BoardOrder; eventType: string; commit_timestamp?: string }) => void>() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => state.t }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/hooks/useBadges", () => ({ badgesChanged: vi.fn() }));
vi.mock("@/hooks/useOnline", () => ({ useOnline: () => ({ online: state.online, markOffline: vi.fn() }) }));
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
const row = (status: OrderStatus = "received"): BoardOrder => ({
  id: "a", restaurant_id: "r1", status, stations_ready: [], items: [], created_at: "2026-10-27T10:00:00Z",
  code: "a", table_label: "1", note: null,
} satisfies KitchenTicket);
const initial = [row()];
function Harness({ readAt = 100 }: { readAt?: number }) {
  hook = useRestaurantOrders("r1", initial, true, readAt);
  return null;
}
async function render(readAt = 100) {
  await act(async () => root.render(<Harness readAt={readAt} />));
}
async function live(status: OrderStatus) {
  await act(async () => state.receive({ eventType: "UPDATE", new: row(status),
    commit_timestamp: new Date(4000).toISOString() }));
}
const ok = () => new Response(null, { status: 204, headers: { Date: new Date(5000).toUTCString() } });
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(200);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok()));
  state.online = false; state.toast.mockClear(); localStorage.clear(); root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("applies the final successful replay when only the intermediate realtime event arrives", async () => {
  localStorage.setItem("tt-offline-queue", JSON.stringify([
    { id: "a", from: "received", to: "preparing", at: 1 },
    { id: "a", from: "preparing", to: "ready", at: 2 },
  ]));
  await render();
  let reply!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(async () => ok())
    .mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  state.online = true; await render();
  await live("preparing");
  await act(async () => reply(ok()));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(hook.pending).toBe(0);
  expect(localStorage.getItem("tt-offline-queue")).toBeNull();
  expect(hook.orders[0].status).toBe("ready");
  await render(3000);
  expect(hook.orders[0].status).toBe("ready");
});
it("reapplies a successful live move after an intermediate event overwrites optimism", async () => {
  let reply!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  await render();
  let move!: Promise<void>;
  await act(async () => { move = hook.updateStatus("a", "preparing"); });
  await live("received");
  await act(async () => { reply(ok()); await move; });
  expect(hook.orders[0].status).toBe("preparing");
});
it("does not pull back a later live stage when an older success arrives", async () => {
  let reply!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  await render();
  let move!: Promise<void>;
  await act(async () => { move = hook.updateStatus("a", "preparing"); });
  await live("ready");
  await act(async () => { reply(ok()); await move; });
  expect(hook.orders[0].status).toBe("ready");
});
it.each([409, 500])("does not apply a queued move answered with %s", async status => {
  localStorage.setItem("tt-offline-queue", JSON.stringify([{ id: "a", from: "received", to: "preparing", at: 1 }]));
  await render();
  vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status }));
  state.online = true; await render();
  expect(hook.pending).toBe(status === 500 ? 1 : 0);
  if (status === 409) expect(state.toast).toHaveBeenCalled();
});
