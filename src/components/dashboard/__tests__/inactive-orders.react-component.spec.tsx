// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardOrder } from "@/lib/kitchen-ticket";
import type { Order, OrderStatus } from "@/lib/types";

const state = vi.hoisted(() => ({
  receive: null as null | ((payload: { new: BoardOrder; eventType: string }) => void),
  toast: vi.fn(), t: (key: string) => key,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => state.t }));
vi.mock("@/hooks/useBadges", () => ({ badgesChanged: vi.fn() }));
vi.mock("@/hooks/useOnline", () => ({ useOnline: () => ({ online: true, markOffline: vi.fn() }) }));
vi.mock("@/hooks/useBoardStation", () => ({ useBoardStation: () => [null, vi.fn()] }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/layout/Breadcrumb", () => ({ default: () => null }));
vi.mock("../ServiceRequestsBar", () => ({ default: () => null }));
vi.mock("../OrderCard", () => ({ default: (props: {
  order: BoardOrder; onAdvance: (id: string, status: OrderStatus) => Promise<void>;
  onStationReady: (id: string, station: "bar") => void;
}) => <div data-order={props.order.id}>
  <button onClick={() => props.onAdvance(props.order.id,
    props.order.status === "received" ? "preparing" : props.order.status === "preparing" ? "ready" : "completed"
  )}>{props.order.status}</button>
  <button onClick={() => props.onStationReady(props.order.id, "bar")}>station</button>
</div> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const channel = { on: (_kind: unknown, _opts: unknown, receive: typeof state.receive) => {
    state.receive = receive; return channel;
  }, subscribe: () => channel };
  return { auth: { getSession: async () => ({ data: { session: null } }) },
    channel: () => channel, removeChannel: vi.fn() };
} }));
import OrdersBoard from "../OrdersBoard";

let container: HTMLDivElement;
let root: Root;
const order = (id: string, status: OrderStatus = "received", written_off = false): Order => ({
  id, restaurant_id: "r1", status, written_off, paid: true, total: 100, currency: "MXN",
  table_id: null, subtotal: 100, service_fee: 0, tip: 0, tax_pct: 0, pay_method: "cash",
  stripe_payment_intent: null, stripe_refund_id: null, table_label: "1", created_at: new Date().toISOString(), items: [], note: null,
});
async function render(orders: BoardOrder[], kitchen = false): Promise<void> {
  await act(async () => root.render(<OrdersBoard restaurant={{ id: "r1", currency: "MXN" }}
    initialOrders={orders} initialRequests={[]} kitchen={kitchen} canCancel={false}
    canMove canSettle={false} isWaiter={false} canApprove={false} showRevenue={!kitchen}
    revenueBase={20} todayStartMs={0} />));
}
const card = (id = "active") => container.querySelector(`[data-order="${id}"]`);
const takings = () => container.querySelectorAll(".tt-stat strong")[1]?.textContent;
async function tap(station = false): Promise<void> {
  await act(async () => (card()!.querySelectorAll("button")[station ? 1 : 0] as HTMLButtonElement).click());
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  state.receive = null; state.toast.mockClear(); localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("excludes written-off orders at every preparation stage and from the active count", async () => {
  await render([order("active"), ...(["received", "preparing", "ready"] as const).map(s => order(s, s, true))]);
  expect(container.querySelectorAll("[data-order]")).toHaveLength(1);
  expect(container.querySelector(".tt-stat strong")?.textContent).toBe("1");
});
it("removes a realtime write-off without changing a paid order's contribution to takings", async () => {
  const original = order("active"); await render([original]); const before = takings();
  await act(async () => state.receive!({ eventType: "UPDATE", new: { ...original, written_off: true } as BoardOrder }));
  expect(card()).toBeNull(); expect(takings()).toBe(before); expect(original.status).toBe("received");
});
it("removes a private kitchen ticket when its projection becomes inactive", async () => {
  const ticket = { id: "active", code: "1234", restaurant_id: "r1", status: "received",
    items: [], note: null, table_label: "1", created_at: new Date().toISOString() } as BoardOrder;
  await render([ticket], true);
  await act(async () => state.receive!({ eventType: "UPDATE", new: { ...ticket, status: "cancelled" } }));
  expect(card()).toBeNull(); expect(ticket).not.toHaveProperty("written_off"); expect(ticket).not.toHaveProperty("total");
});
it.each([false, true])("retires a stale inactive tap, station=%s, without erasing takings or queuing a retry", async station => {
  const original = order("active"); await render([original]); const before = takings();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ inactive: true, error: "no longer active" }), { status: 409 })));
  await tap(station);
  expect(card()).toBeNull(); expect(takings()).toBe(before);
  expect(state.toast).toHaveBeenCalledWith("no longer active", "error");
  expect(localStorage.length).toBe(0); expect(original.status).toBe("received");
});
it("keeps an ordinary stage conflict visible with its reason", async () => {
  await render([order("active")]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "stage changed" }), { status: 409 })));
  await tap(); expect(card()?.textContent).toContain("received");
});
it("moves normal orders through all stages and keeps completed takings", async () => {
  await render([order("active")]); const before = takings();
  await tap(); expect(card()?.textContent).toContain("preparing");
  await tap(); expect(card()?.textContent).toContain("ready");
  await tap(); expect(card()).toBeNull(); expect(takings()).toBe(before);
});
it("retires a refused offline move on reconnect instead of replaying it forever", async () => {
  localStorage.setItem("tt-offline-queue", JSON.stringify([{ id: "active", from: "received", to: "preparing", at: 1 }]));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ inactive: true }), { status: 409 })));
  await render([order("active")]);
  expect(card()).toBeNull(); expect(localStorage.getItem("tt-offline-queue")).toBeNull();
});
