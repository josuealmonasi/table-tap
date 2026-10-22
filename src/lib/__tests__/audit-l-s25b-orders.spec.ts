import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ orders: [] as Record<string, unknown>[], stock: 10, reservations: 0 }));
const dish = { itemId: "dish", name: "Dish", price: 100, qty: 1, emoji: "", mods: {} };
const ref = "00000000-0000-4000-8000-000000000001";
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", role: "owner", email: "owner" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { allows_deferred_payment: true, allows_inventory: true } }), tierIncludes: async () => true }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/checkout/orderable-now", () => ({ orderableNow: async () => ({ closedNow: false, onOpenMenu: () => true }) }));
vi.mock("@/lib/open-menus", () => ({ DEFAULT_TIME_ZONE: "UTC", openMenuIds: () => ({ ids: [], closedNow: false }) }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/checkout/verified-lines", () => ({ verifiedLines: async () => ({ ok: true, lines: [dish] }) }));
vi.mock("@/lib/verify-cart", () => ({ cartReferences: () => ({ ok: true, ids: ["dish"] }), verifyCart: () => ({ ok: true, lines: [dish] }) }));
vi.mock("@/lib/checkout/claim-coupon", () => ({ claimCheckoutCoupon: async () => ({ coupon: null }), logCheckoutCoupon: async () => {} }));
vi.mock("@/lib/table-session", () => ({ openSession: async () => "sitting" }));
vi.mock("@/lib/table-member-cookie", () => ({ memberHash: () => null }));
vi.mock("@/lib/checkout/card-session", () => ({ openCardSession: vi.fn() }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/stock-service", () => ({
  reserveStock: async () => { state.stock--; state.reservations++; return { ok: true, low: [], reservationId: ref }; },
  raiseStockNotifications: async () => {}, releaseStock: async () => {},
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    let row: Record<string, unknown> | null = null;
    const result = () => ({ data: table === "restaurants" ? { id: "r", currency: "MXN", accepting_orders: true, allow_pay_later: true }
      : table === "restaurant_tables" ? { id: "table", label: "1" } : table === "orders" ? row : [], error: null });
    const q = { select: () => q, eq: () => q, in: () => q,
      insert: (value: Record<string, unknown>) => { row = { id: crypto.randomUUID(), ...value }; state.orders.push(row); return q; },
      single: async () => result(), maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return q;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    const old = state.orders.find(o => o.request_ref === args.p_ref);
    if (old && old.request_scope !== args.p_scope) return { data: { conflict: true }, error: null };
    if (name === "order_intent_result") return { data: old ? { ...old, orderId: old.id, repeat: true } : null, error: null };
    if (old) return { data: { ...old, orderId: old.id, repeat: true }, error: null };
    state.stock--; state.reservations++;
    const order = { ...(args.p_order as object), id: crypto.randomUUID(), request_ref: args.p_ref, request_scope: args.p_scope };
    state.orders.push(order);
    return { data: { ...order, orderId: order.id, low: [] }, error: null };
  },
}) }));
const checkout = await import("@/app/api/checkout/route");
beforeEach(() => { state.orders = []; state.stock = 10; state.reservations = 0; });
const base = { restaurantId: "r", tableId: null, payLater: true, items: [dish], ref };
const send = (body: object) => checkout.POST(new NextRequest("https://test/api/checkout", { method: "POST", body: JSON.stringify(body) }));
it.each([
  { items: [{ ...dish, qty: 2 }] }, { couponCode: "DIFFERENT" }, { tipAmount: 20 },
  { tableId: "00000000-0000-4000-8000-0000000000f2" }, { items: [{ ...dish, mods: { Milk: "Oat" } }] },
])("L6 a counter reference refuses a different request without disclosing the first ticket: %j", async changed => {
  expect((await send(base)).status).toBe(200);
  const second = await send({ ...base, ...changed });
  expect(second.status).toBe(409);
  expect(await second.json()).not.toHaveProperty("orderId");
  expect(state.orders).toHaveLength(1);
});
it("L6 the same counter request still recovers its one ticket without a cookie", async () => {
  const first = await (await send(base)).json();
  const second = await (await send(base)).json();
  expect(second.orderId).toBe(first.orderId);
  expect(state.stock).toBe(9);
});
