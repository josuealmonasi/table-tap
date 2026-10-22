import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("react", () => ({ useState: (v: unknown) => [v, vi.fn()], useRef: (v: unknown) => ({ current: v }), useCallback: (fn: unknown) => fn }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (k: string) => k }));
vi.mock("@/lib/usual", () => ({ rememberUsual: vi.fn() }));
vi.mock("@/lib/my-orders", () => ({ rememberMyOrder: vi.fn() }));
vi.mock("@/lib/recent-order", () => ({ rememberRecentOrder: vi.fn() }));
vi.mock("@/lib/upsell", () => ({ clearUpsell: vi.fn() }));
vi.mock("@/lib/diner-name", () => ({ rememberDinerName: vi.fn() }));
vi.mock("@/lib/diner-token", () => ({ dinerToken: () => "phone" }));
const { useCheckout } = await import("@/hooks/useCheckout");
const { useCostsSend } = await import("@/hooks/useCostsSend");
const bodies = () => state.fetch.mock.calls.map(call => JSON.parse(call[1].body));
beforeEach(() => { state.fetch.mockReset(); vi.stubGlobal("fetch", state.fetch); });
function useMenu() {
  const input = { restaurantId: "r", table: null, orderableItems: [{ itemId: "dish", qty: 1 }],
    orderNote: "First", customerName: "", tipPct: 0, tipCustom: null, coupon: null,
    cart: { clear: vi.fn() }, onPlaced: vi.fn(), notify: vi.fn() };
  return { input, ...useCheckout(input as unknown as Parameters<typeof useCheckout>[0]) };
}
it("K4 pay-later retries the frozen order after a lost or unreadable reply, then starts a new intent", async () => {
  const cart = useMenu();
  state.fetch.mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(new Response("not JSON"))
    .mockResolvedValueOnce(Response.json({ orderId: "one", deferred: true })).mockResolvedValueOnce(Response.json({ orderId: "two", deferred: true }));
  await cart.checkout(true);
  cart.input.orderNote = "Changed";
  await cart.checkout(true); await cart.checkout(true); await cart.checkout(true);
  expect(bodies()[1]).toEqual(bodies()[0]); expect(bodies()[2]).toEqual(bodies()[0]);
  expect(bodies()[3].ref).not.toBe(bodies()[0].ref); expect(bodies()[3].note).toBe("Changed");
});
it("K4 a definite refusal releases the intent while a server failure keeps it", async () => {
  const cart = useMenu();
  state.fetch.mockResolvedValueOnce(Response.json({ error: "unknown" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ error: "closed" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ orderId: "one", deferred: true }));
  await cart.checkout(true); await cart.checkout(true); await cart.checkout(true);
  expect(bodies()[1].ref).toBe(bodies()[0].ref); expect(bodies()[2].ref).not.toBe(bodies()[0].ref);
});
it("K4 card checkout retains its existing request shape", async () => {
  state.fetch.mockResolvedValue(Response.json({ error: "no card" }, { status: 409 }));
  await useMenu().checkout(false); expect(bodies()[0]).not.toHaveProperty("ref");
});
it.each(["purchases", "waste"])("K6 %s keeps its frozen request through a network or server failure", async path => {
  const send = useCostsSend(true);
  state.fetch.mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(Response.json({ error: "retry" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true, id: "saved" })).mockResolvedValueOnce(Response.json({ ok: true, id: "next" }));
  for (const quantity of [1, 2, 3, 4]) await send(`/api/costs/${path}`, "POST", { quantity });
  expect(bodies()[1]).toEqual(bodies()[0]); expect(bodies()[2]).toEqual(bodies()[0]);
  expect(bodies()[3].quantity).toBe(4); expect(bodies()[3].ref).not.toBe(bodies()[0].ref);
});
