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

vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "es" }));

let admissionStatus = "approved";
let admissionFullOnOpen = false;
const step = {
  counterFull: vi.fn(async () => ({ data: false, error: null as unknown })),
  intent: vi.fn(async () => ({ orderId: "order-1", sessionId: null, table: null, total: 90 })),
  openSession: vi.fn(async (): Promise<string | null> => "sitting-1"),
  reserveStock: vi.fn(async () => ({ ok: true, short: [], low: [] as typeof soldOut[], reservationId: "reservation-1" })),
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
const notices: Record<string, unknown>[] = [];
const soldOut = { itemId: "t1", name: "Taco", stock: 0, kind: "out_of_stock" as const };

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
  apiError: async (key: string, status: number, _vars?: unknown, extra?: Record<string, unknown>) =>
    NextResponse.json({ ...extra, error: key }, { status }),
}));
vi.mock("@/lib/rate-limit", () => ({
  isRoomLimited: async () => false,
  isTableLimited: async () => false,
}));
vi.mock("@/lib/plan-server", () => ({
  getPlan: async () => ({ limits: { allows_deferred_payment: true, allows_dine_in: true, order_fee: 0, fee_cap: null } }),
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
vi.mock("@/lib/table-guard", () => ({ tableOf: async () => ({ id: "00000000-0000-4000-8000-0000000000f1" }) }));
vi.mock("@/lib/table-member-cookie", () => ({ memberHash: () => "hash" }));
vi.mock("@/lib/table-membership", () => ({ requestTableMember: async (...args: unknown[]) => ({
  status: args[3] && admissionFullOnOpen ? "full" : admissionStatus, sessionId: await step.openSession(), diner: "member-1",
}) }));
vi.mock("@/lib/stock-service", () => ({
  reserveStock: () => step.reserveStock(),
  releaseStock: (r: string, lines: unknown) => releaseStock(r, lines),
  raiseStockNotifications: async () => {
    await step.notify();
    notices.push({ id: "attempt", restaurant_id: "r1", data: { itemId: "t1" } });
  },
}));
vi.mock("@/lib/checkout/app-fee", () => ({ checkoutFee: async () => ({ id: null, cents: 0 }) }));
vi.mock("@/lib/platform-fee", () => ({
  NO_FEE: { id: null, cents: 0 },
  releaseFee: async () => {},
  feeMetadata: () => ({}),
  stripeRefusedOutright: () => true,
}));
vi.mock("@/lib/checkout/card-session", () => ({ openCardSession: () => step.openCard() }));
vi.mock("@/lib/checkout/cart-error", () => ({
  refuseCart: async () => NextResponse.json({ error: "cart" }, { status: 400 }),
  refuseShortStock: async () => NextResponse.json({ error: "short" }, { status: 409 }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: () => step.counterFull(),
    from: (table: string) => {
      if (table === "notifications") {
        const filters: Record<string, unknown> = {};
        const q = {
          eq: (key: string, value: unknown) => { filters[key] = value; return q; },
          insert: async (rows: Record<string, unknown>[]) => { await step.notify(); notices.push(...rows); return { error: null }; },
          delete: () => q,
          then: (resolve: (value: unknown) => void) => {
            for (let i = notices.length - 1; i >= 0; i--) {
              if (Object.entries(filters).every(([key, value]) => key === "data->>itemId"
                ? (notices[i].data as { itemId: string }).itemId === value : notices[i][key] === value)) notices.splice(i, 1);
            }
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return q;
      }
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
vi.mock("@/lib/order-intent", () => ({ readOrderIntent: async () => null, writeOrderIntent: () => step.intent() }));

const { POST } = await import("@/app/api/checkout/route");

function checkout(extra: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        restaurantId: "r1", tableId: "00000000-0000-4000-8000-0000000000f1", tableLabel: "4", items: [taco], couponCode: "TACO10",
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
  step.counterFull.mockResolvedValue({ data: false, error: null });
  notices.length = 0;
  admissionStatus = "approved";
  admissionFullOnOpen = false;
  step.openSession.mockImplementation(async () => "sitting-1");
  step.reserveStock.mockImplementation(async () => ({ ok: true, short: [], low: [], reservationId: "reservation-1" }));
  step.insertOrder.mockImplementation(async () => ({ data: { id: "order-1" }, error: null }));
  step.notify.mockImplementation(async () => undefined);
  step.openCard.mockImplementation(async () => ({ id: "cs_1", url: "https://stripe.test/cs_1" }));
  step.logCoupon.mockImplementation(async () => undefined);
  step.saveSession.mockImplementation(async () => ({ error: null }));
});

describe("M1: unpaid counter orders have a restaurant-wide ceiling", () => {
  it("refuses a full counter with card and register alternatives, returning all claims", async () => {
    step.counterFull.mockResolvedValue({ data: true, error: null });
    const response = await checkout({ tableId: null, payLater: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "apiErr.counterPayLaterFull" });
    expect(step.insertOrder).not.toHaveBeenCalled();
    expect(releaseStock).toHaveBeenCalledOnce();
    expect(releaseCoupon).toHaveBeenCalledOnce();
  });
  it.each([{ tableId: null }, { payLater: true }])("never caps card or table orders: %j", async extra => {
    step.counterFull.mockResolvedValue({ data: true, error: null });
    expect((await checkout(extra)).status).toBe(200);
    expect(step.counterFull).not.toHaveBeenCalled();
  });
  it("allows a counter order below the ceiling", async () => {
    expect((await checkout({ tableId: null, payLater: true })).status).toBe(200);
    expect(step.insertOrder).toHaveBeenCalledOnce();
  });
  it("creates nothing when the ceiling could not be read", async () => {
    step.counterFull.mockResolvedValue({ data: false, error: { message: "unavailable" } });
    expect((await checkout({ tableId: null, payLater: true })).status).toBe(500);
    expect(step.insertOrder).not.toHaveBeenCalled();
  });
  it("answers the atomic writer's refusal without claiming an order exists", async () => {
    step.intent.mockResolvedValueOnce({ counterFull: true } as never);
    const response = await checkout({ tableId: null, payLater: true, ref: "00000000-0000-4000-8000-0000000000f2" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "apiErr.counterPayLaterFull" });
    expect(step.insertOrder).not.toHaveBeenCalled();
  });
});

describe("a checkout that dies halfway gives back what it had claimed", () => {
  it("claims no coupon when the sitting cannot be opened", async () => {
    step.openSession.mockImplementation(async () => boom());
    const res = await checkout();
    expect(res.status).toBe(500);
    expect(releaseCoupon).not.toHaveBeenCalled();
    expect(releaseStock).not.toHaveBeenCalled();
  });

  it("hands back the coupon and the stock when the order cannot be written", async () => {
    step.insertOrder.mockImplementation(async () => boom());
    expect((await checkout()).status).toBe(500);
    expect(releaseCoupon).toHaveBeenCalledTimes(1);
    expect(releaseStock).toHaveBeenCalledTimes(1);
  });

  it("removes a card order that died before Stripe was asked", async () => {
    step.logCoupon.mockImplementation(async () => boom());
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


describe("admission before a new table order", () => {
  it("M2: refuses an unqueued phone at a full sitting before claiming anything", async () => {
    admissionStatus = "full";
    const response = await checkout({ payLater: true });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "apiErr.tableJoinFull" });
    expect(step.reserveStock).not.toHaveBeenCalled();
    expect(step.insertOrder).not.toHaveBeenCalled();
    expect(releaseCoupon).not.toHaveBeenCalled();
  });
  it("M2: returns the coupon if admission fills while the cart is priced", async () => {
    admissionFullOnOpen = true;
    expect((await checkout({ payLater: true })).status).toBe(429);
    expect(releaseCoupon).toHaveBeenCalledOnce();
    expect(step.reserveStock).not.toHaveBeenCalled();
    expect(step.insertOrder).not.toHaveBeenCalled();
  });
  it.each(["pending", "rejected"])("does not reserve or insert food for a %s phone", async status => {
    admissionStatus = status;
    expect((await checkout({ payLater: true })).status).toBe(403);
    expect(step.reserveStock).not.toHaveBeenCalled();
    expect(step.insertOrder).not.toHaveBeenCalled();
    expect(step.openCard).not.toHaveBeenCalled();
    expect(releaseCoupon).not.toHaveBeenCalled();
  });
  it("keeps the first phone at an empty table ordering normally", async () => {
    expect((await checkout({ payLater: true })).status).toBe(200);
    expect(step.insertOrder).toHaveBeenCalledOnce();
  });
});


it("removes only this failed card attempt's stock alert after returning its stock", async () => {
  notices.push({ id: "committed-sale", restaurant_id: "r1", data: { itemId: "t1" } },
    { id: "other-restaurant", restaurant_id: "r2", data: { itemId: "t1" } });
  step.reserveStock.mockResolvedValue({ ok: true, short: [], low: [soldOut], reservationId: "reservation-1" });
  step.openCard.mockRejectedValue({ code: "amount_too_small" });
  expect((await checkout()).status).toBe(400);
  expect(releaseStock).toHaveBeenCalledOnce();
  expect(notices.map(n => n.id)).toEqual(["committed-sale", "other-restaurant"]);
});

it("keeps the stock alert when Stripe takes responsibility for the card order", async () => {
  step.reserveStock.mockResolvedValue({ ok: true, short: [], low: [soldOut], reservationId: "reservation-1" });
  expect((await checkout()).status).toBe(200);
  expect(notices).toHaveLength(1);
});

describe("never charges more than the diner reviewed (A2, end-to-end review)", () => {
  it("refuses a higher total with today's prices, gives the coupon back and writes nothing", async () => {
    const res = await checkout({ reviewedTotal: 0.01 });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("prices_changed");
    expect(typeof data.prices[taco.itemId]).toBe("number");
    expect(releaseCoupon).toHaveBeenCalledTimes(1);
    expect(step.insertOrder).not.toHaveBeenCalled();
    expect(step.reserveStock).not.toHaveBeenCalled();
  });

  it("goes ahead at or under the total that was shown", async () => {
    const res = await checkout({ reviewedTotal: 1_000_000 });
    expect(res.status).not.toBe(409);
    expect(step.insertOrder).toHaveBeenCalled();
  });
});
