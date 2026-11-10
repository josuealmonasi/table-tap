// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => s.toast }));
vi.mock("@/hooks/useOnline", () => ({ useOnline: () => ({ online: false, markOffline: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { auth: { getSession: async () => ({ data: { session: null } }) }, channel: () => channel, removeChannel: vi.fn() };
} }));
import { useRestaurantOrders } from "../useRestaurantOrders";
let hook: ReturnType<typeof useRestaurantOrders>, root: Root;
const rows: never[] = [];
function Harness() { hook = useRestaurantOrders("restaurant", rows); return null; }
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear();
  root = createRoot(document.createElement("div"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Unconfirmed", checkoutCode: "checkout_unresolved" }, { status: 409 })));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("keeps the refusal from the cancellation preview without posting a cancellation", async () => {
  await act(async () => { expect(await hook.cancelPlanFor("order")).toBe("Unconfirmed"); });
  expect(hook.checkoutRefusal).toEqual({ kind: "orders", orderIds: ["order"] });
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/orders/cancel?id=order");
});
it("keeps the POST refusal without replaying its previous confirmation", async () => {
  await act(async () => { expect(await hook.cancelOrder("order")).toEqual({ error: "Unconfirmed", stale: false }); });
  expect(hook.checkoutRefusal).toEqual({ kind: "orders", orderIds: ["order"] });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("another order's ordinary failure clears the old recovery scope", async () => {
  await act(async () => { await hook.cancelPlanFor("order"); });
  vi.mocked(fetch).mockResolvedValue(Response.json({ error: "Other error" }, { status: 503 }));
  await act(async () => { await hook.cancelPlanFor("other"); });
  expect(hook.checkoutRefusal).toBeNull();
});
