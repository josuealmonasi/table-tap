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
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
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
import { PAID_REFRESH_MS } from "@/hooks/useRefreshWhenPaid";

// Audit N findings 3 and 4. The board's "today" is the server's ledger figure,
// so a refresh no longer has to replace the live list to keep it honest, and
// replacing it was what dropped orders that arrived during the refresh.
let container: HTMLDivElement;
let root: Root;
const order = (id: string, status: OrderStatus = "received", paid = false): Order => ({
  id, restaurant_id: "r1", status, written_off: false, paid, total: 100, currency: "MXN",
  table_id: null, subtotal: 100, service_fee: 0, tip: 0, tax_pct: 0, pay_method: "cash",
  stripe_payment_intent: null, stripe_refund_id: null, table_label: "1", created_at: new Date().toISOString(), items: [], note: null,
});
async function render(orders: BoardOrder[], collected: number): Promise<void> {
  await act(async () => root.render(<OrdersBoard restaurant={{ id: "r1", currency: "MXN" }}
    initialOrders={orders} initialRequests={[]} canCancel={false} canMove canSettle={false}
    isWaiter={false} canApprove={false} showRevenue collectedToday={collected} />));
}
const takings = () => container.querySelectorAll(".tt-stat strong")[1]?.textContent ?? "";
const shown = () => [...container.querySelectorAll("[data-order]")].map(c => `${c.getAttribute("data-order")}:${c.querySelector("button")?.textContent}`);
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  state.receive = null; refresh.mockClear(); localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows the server's figure, never the server's plus the list's (audit M finding 2)", async () => {
  await render([order("paid", "ready", true)], 100);
  await render([order("paid", "ready", true)], 100);
  expect(takings()).toContain("100");
  expect(takings()).not.toContain("200");
});
it("a refresh's older snapshot keeps an order realtime brought in meanwhile", async () => {
  await render([order("a")], 0);
  await act(async () => state.receive!({ eventType: "INSERT", new: order("b") as BoardOrder }));
  await render([order("a")], 0);
  expect(shown()).toEqual(expect.arrayContaining(["a:received", "b:received"]));
});
it("a refresh's older snapshot keeps a move realtime confirmed meanwhile", async () => {
  await render([order("a")], 0);
  await act(async () => state.receive!({ eventType: "UPDATE", new: order("a", "preparing") as BoardOrder }));
  await render([order("a")], 0);
  expect(shown()).toEqual(["a:preparing"]);
});
it("asks the server for the day's figure again when realtime shows an order paid", async () => {
  vi.useFakeTimers();
  const asked = vi.fn();
  window.addEventListener("tt-orders-takings-changed", asked);
  await render([order("a")], 0);
  await act(async () => state.receive!({ eventType: "UPDATE", new: order("a", "preparing") as BoardOrder }));
  await act(async () => { vi.advanceTimersByTime(PAID_REFRESH_MS * 2); });
  expect(asked).not.toHaveBeenCalled(); // a kitchen move is not money
  await act(async () => state.receive!({ eventType: "UPDATE", new: order("a", "preparing", true) as BoardOrder }));
  await act(async () => { vi.advanceTimersByTime(PAID_REFRESH_MS); });
  expect(asked).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled(); // its own read, never the whole page
  window.removeEventListener("tt-orders-takings-changed", asked);
});
