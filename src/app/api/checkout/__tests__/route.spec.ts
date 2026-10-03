import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * The diner's checkout, driven end to end with every step it calls replaced,
 * so each step can be made to fail at the worst moment.
 *
 * What it holds the route to: whatever the request had claimed — the coupon's
 * use, the stock, the pending order — goes back exactly once when the request
 * dies, and nothing goes back once somebody else owns it.
 */

const step = {
  openSession: vi.fn(async (): Promise<string | null> => "sitting-1"),
  reserveStock: vi.fn(async () => ({ ok: true, short: [], low: [] })),
  insertOrder: vi.fn(async (): Promise<{ data: { id: string } | null; error: unknown }> => ({
    data: { id: "order-1" },
    error: null,
  })),
  notify: vi.fn(async () => undefined),
  openCard: vi.fn(async () => ({ id: "cs_1", url: "https://stripe.test/cs_1" })),
  logCoupon: vi.fn(async () => undefined),
  saveSession: vi.fn(async () => ({ error: null })),
};
const releaseCoupon = vi.fn<(id: string) => Promise<void>>(async () => undefined);
const releaseStock = vi.fn<(restaurantId: string, lines: unknown) => Promise<void>>(async () => undefined);
const deleteOrder = vi.fn(async () => ({ error: null }));

const restaurant = {
  id: "r1", currency: "MXN", service_pct: 0, service_enabled: false, accepting_orders: true,
  tax_pct: 16, stripe_account_id: "acct_1", stripe_charges_enabled: true, allow_pay_later: true,
  low_stock_alerts_enabled: true, low_stock_threshold: 2,
};
const coupon = {
  id: "c1", code: "TACO10", kind: "percent", value: 10, min_subtotal: 0, staff_only: false,
  max_uses: 5, uses_count: 1, active: true, starts_at: null, ends_at: null,
};
const taco = { itemId: "t1", name: "Taco", emoji: "🌮", price: 50, qty: 2, mods: {} };

vi.mock("@/lib/api-error", () => ({
  apiError: async (key: string, status: number) => NextResponse.json({ error: key }, { status }),
}));
vi.mock("@/lib/rate-limit", () => ({
  isRoomLimited: async () => false,
  isTableLimited: async () => false,
}));
vi.mock("@/lib/plan-server", () => ({
  getPlan: async () => ({ limits: { allows_deferred_payment: true, order_fee: 0, fee_cap: null } }),
}));
vi.mock("@/lib/checkout/orderable-now", () => ({
  orderableNow: async () => ({ closedNow: false, onOpenMenu: () => true }),
}));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/checkout/verified-lines", () => ({
  verifiedLines: async () => ({ ok: true, lines: [taco] }),
}));
vi.mock("@/lib/checkout/claim-coupon", () => ({
  claimCheckoutCoupon: async () => ({ coupon }),
  logCheckoutCoupon: () => step.logCoupon(),
}));
vi.mock("@/lib/coupon-service", () => ({
  releaseCoupon: (id: string) => releaseCoupon(id),
  toAppliedCoupon: (c: typeof coupon) => ({ code: c.code, kind: c.kind, value: c.value, minSubtotal: 0 }),
}));
vi.mock("@/lib/table-guard", () => ({ tableOf: async () => ({ id: "t-1" }) }));
vi.mock("@/lib/table-session", () => ({ openSession: () => step.openSession() }));
vi.mock("@/lib/stock-service", () => ({
  reserveStock: () => step.reserveStock(),
  releaseStock: (r: string, lines: unknown) => releaseStock(r, lines),
  raiseStockNotifications: () => step.notify(),
}));
vi.mock("@/lib/checkout/app-fee", () => ({ checkoutFeeCents: async () => 0 }));
vi.mock("@/lib/checkout/card-session", () => ({ openCardSession: () => step.openCard() }));
vi.mock("@/lib/checkout/cart-error", () => ({
  refuseCart: async () => NextResponse.json({ error: "cart" }, { status: 400 }),
  refuseShortStock: async () => NextResponse.json({ error: "short" }, { status: 409 }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "restaurants") {
        const q = { select: () => q, eq: () => q, single: async () => ({ data: restaurant, error: null }) };
        return q;
      }
      return {
        insert: () => ({ select: () => ({ single: () => step.insertOrder() }) }),
        delete: () => ({ eq: () => deleteOrder() }),
        update: () => ({ eq: () => step.saveSession() }),
      };
    },
  }),
}));

const { POST } = await import("@/app/api/checkout/route");

function checkout(extra: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        restaurantId: "r1", tableId: "t-1", tableLabel: "4", items: [taco], couponCode: "TACO10",
        ...extra,
      }),
    }),
  );
}

const boom = () => {
  throw new Error("connection dropped");
};

beforeEach(() => {
  vi.clearAllMocks();
  step.openSession.mockImplementation(async () => "sitting-1");
  step.reserveStock.mockImplementation(async () => ({ ok: true, short: [], low: [] }));
  step.insertOrder.mockImplementation(async () => ({ data: { id: "order-1" }, error: null }));
  step.notify.mockImplementation(async () => undefined);
  step.openCard.mockImplementation(async () => ({ id: "cs_1", url: "https://stripe.test/cs_1" }));
  step.logCoupon.mockImplementation(async () => undefined);
  step.saveSession.mockImplementation(async () => ({ error: null }));
});

describe("a checkout that dies halfway gives back what it had claimed", () => {
  it("hands back the coupon when the sitting cannot be opened", async () => {
    step.openSession.mockImplementation(async () => boom());
    const res = await checkout();
    expect(res.status).toBe(500);
    expect(releaseCoupon).toHaveBeenCalledTimes(1);
    expect(releaseStock).not.toHaveBeenCalled();
  });

  it("hands back the coupon and the stock when the order cannot be written", async () => {
    step.insertOrder.mockImplementation(async () => boom());
    expect((await checkout()).status).toBe(500);
    expect(releaseCoupon).toHaveBeenCalledTimes(1);
    expect(releaseStock).toHaveBeenCalledTimes(1);
  });

  it("removes a card order that died before Stripe was asked", async () => {
    step.notify.mockImplementation(async () => boom());
    expect((await checkout()).status).toBe(500);
    expect(deleteOrder).toHaveBeenCalledTimes(1);
    expect(releaseCoupon).toHaveBeenCalledTimes(1);
    expect(releaseStock).toHaveBeenCalledTimes(1);
  });

  it("gives the coupon back once, not twice, when Stripe refuses the session", async () => {
    step.openCard.mockImplementation(async () => boom());
    expect((await checkout()).status).toBe(500);
    expect(releaseCoupon).toHaveBeenCalledTimes(1);
    expect(releaseStock).toHaveBeenCalledTimes(1);
    expect(deleteOrder).toHaveBeenCalledTimes(1);
  });

  it("gives back a card order whose coupon could not be written down", async () => {
    // Stripe's expiry only returns a use it finds written down, so until then
    // the use is this request's to return.
    step.logCoupon.mockImplementation(async () => boom());
    expect((await checkout()).status).toBe(500);
    expect(releaseCoupon).toHaveBeenCalledTimes(1);
    expect(deleteOrder).toHaveBeenCalledTimes(1);
  });
});

describe("what is somebody else's is left alone", () => {
  it("keeps a pay-later order that the kitchen already has", async () => {
    step.notify.mockImplementation(async () => boom());
    expect((await checkout({ payLater: true })).status).toBe(500);
    expect(releaseCoupon).not.toHaveBeenCalled();
    expect(releaseStock).not.toHaveBeenCalled();
    expect(deleteOrder).not.toHaveBeenCalled();
  });

  it("leaves a card order with Stripe once its session is open and its coupon recorded", async () => {
    step.saveSession.mockImplementation(async () => boom());
    expect((await checkout()).status).toBe(500);
    expect(releaseCoupon).not.toHaveBeenCalled();
    expect(deleteOrder).not.toHaveBeenCalled();
  });

  it("gives nothing back from a checkout that worked", async () => {
    const res = await checkout();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "https://stripe.test/cs_1", orderId: "order-1" });
    expect(releaseCoupon).not.toHaveBeenCalled();
    expect(releaseStock).not.toHaveBeenCalled();
  });
});
