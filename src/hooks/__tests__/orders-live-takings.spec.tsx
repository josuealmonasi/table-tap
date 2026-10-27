// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardOrder } from "@/lib/kitchen-ticket";
import OrdersTakings, { ordersTakingsChanged } from "@/components/dashboard/OrdersTakings";
import type { Order } from "@/lib/types";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { useRefreshWhenPaid, PAID_REFRESH_MS } from "../useRefreshWhenPaid";
let root: Root;
let container: HTMLDivElement;
const cache = new Map();
const row = (patch = {}): BoardOrder => ({ id: "a", paid: false, total: 100, status: "received", ...patch } as Order);
function Harness({ orders, enabled }: { orders: BoardOrder[]; enabled: boolean }) {
  useRefreshWhenPaid(orders, enabled, "r1");
  return <button onClick={() => ordersTakingsChanged("r1")}>
    {enabled && <OrdersTakings restaurantId="r1" currency="MXN" initialCollected={0} />}
  </button>;
}
async function render(orders: BoardOrder[], enabled = true) {
  await act(async () => root.render(<SWRConfig value={{ provider: () => cache }}>
    <Harness orders={orders} enabled={enabled} />
  </SWRConfig>));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ restaurantId: "r1", currency: "MXN", collectedToday: 50 }) })));
  refresh.mockClear(); cache.clear(); container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(["partial collection", "split share", "refund without an order change"])("polls for a %s without a paid-ID change", async () => {
  await render([row()]);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetch).toHaveBeenCalledWith("/api/orders/takings", expect.objectContaining({ cache: "no-store" }));
  expect(container.textContent).toContain("50");
});
it.each([{ paid: true }, { paid: true, status: "cancelled" }, { total: 70 }])("invalidates money changes %j", async patch => {
  await render([row({ paid: patch.status === "cancelled" })]);
  await render([row({ ...patch, status: patch.status ?? "received", paid: patch.paid ?? false })]);
  await act(async () => { await vi.advanceTimersByTimeAsync(PAID_REFRESH_MS); });
  expect(fetch).toHaveBeenCalled();
});
it.each(["kitchen", "waiter", "cashier"])("never fetches takings for %s", async () => {
  await render([row()], false);
  await render([row({ paid: true })], false);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetch).not.toHaveBeenCalled();
});

it("refreshes immediately after a local money action", async () => {
  await render([row()]);
  await act(async () => container.querySelector("button")!.click());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("50");
});
it("keeps the last known figure when the read fails, then recovers", async () => {
  await render([row()]);
  await act(async () => container.querySelector("button")!.click());
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toContain("50");
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toContain("50");
});
