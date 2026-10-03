import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
const feesTaken = vi.fn(async () => 0);
vi.mock("@/lib/fee-month", () => ({ feesTakenThisMonth: () => feesTaken() }));

import type { PlanLimits } from "@/lib/plan";
import type { RestaurantPlan } from "@/lib/plan-server";
import type { PricedCart } from "@/lib/pricing";
import type { OrderLineItem } from "@/lib/types";
import { checkoutTip } from "@/lib/checkout/checkout-body";
import { payLaterAllowed } from "@/lib/checkout/pay-later";
import { checkoutFeeCents } from "@/lib/checkout/app-fee";
import { checkoutOrderRow } from "@/lib/checkout/order-row";
import { refuseCart, refuseShortStock } from "@/lib/checkout/cart-error";
import { verifiedLines } from "@/lib/checkout/verified-lines";

const limits = (over: Partial<PlanLimits>) => ({ order_fee: 5, fee_cap: null, ...over }) as PlanLimits;
const plan = (over: Partial<PlanLimits>) => ({ limits: limits(over) }) as RestaurantPlan;

describe("the tip a checkout accepts", () => {
  it("keeps a preset percentage and turns any other into none", () => {
    expect(checkoutTip({ tipPct: 15 })).toEqual({ tipPct: 15, tipAmount: null });
    expect(checkoutTip({ tipPct: 99 })).toEqual({ tipPct: 0, tipAmount: null });
  });

  it("keeps an exact amount to the cent and drops one that is not money", () => {
    expect(checkoutTip({ tipAmount: 12.345 }).tipAmount).toBe(12.35);
    expect(checkoutTip({ tipAmount: -5 }).tipAmount).toBeNull();
    expect(checkoutTip({ tipAmount: Number.NaN }).tipAmount).toBeNull();
  });
});

describe("pay later", () => {
  it("needs the owner's switch AND a plan that includes it", () => {
    expect(payLaterAllowed(true, limits({ allows_deferred_payment: true }))).toBe(true);
    expect(payLaterAllowed(false, limits({ allows_deferred_payment: true }))).toBe(false);
    expect(payLaterAllowed(true, limits({ allows_deferred_payment: false }))).toBe(false);
  });

  it("is refused when the plan cannot be read", () => {
    expect(payLaterAllowed(true, undefined)).toBe(false);
  });
});

describe("our fee on a diner's order", () => {
  beforeEach(() => feesTaken.mockClear());

  it("is nothing on a pay-later order or without a plan", async () => {
    expect(await checkoutFeeCents("r", plan({}), true, 200)).toBe(0);
    expect(await checkoutFeeCents("r", null, false, 200)).toBe(0);
  });

  it("is judged on the food and only looks up the month when there is a ceiling", async () => {
    expect(await checkoutFeeCents("r", plan({}), false, 200)).toBe(500);
    expect(feesTaken).not.toHaveBeenCalled();
    feesTaken.mockResolvedValueOnce(9_800);
    expect(await checkoutFeeCents("r", plan({ fee_cap: 100 }), false, 200)).toBe(200);
  });
});

describe("the row a checkout writes", () => {
  const pricing = {
    subtotal: 100, serviceFee: 10, tip: 15, discount: 0, total: 125,
    itemDiscount: 0, promoDiscount: 0, couponDiscount: 0,
  } as PricedCart;
  const base = {
    restaurantId: "r", tableId: "t", tableLabel: "Mesa 1", sessionId: "s", diner: "phone-1",
    deferred: false, pricing, taxPct: 16, appFeeCents: 500, couponCode: null, currency: "MXN",
    verified: [] as OrderLineItem[], note: undefined, customerName: "Ana",
  };

  it("waits for the card unless it is a pay-later order", () => {
    expect(checkoutOrderRow(base).status).toBe("pending_payment");
    expect(checkoutOrderRow({ ...base, deferred: true }).status).toBe("received");
    expect(checkoutOrderRow(base).paid).toBe(false);
  });

  it("keeps a name only off a table, and only a phone id that could be ours", () => {
    expect(checkoutOrderRow(base).customer_name).toBeNull();
    expect(checkoutOrderRow({ ...base, tableId: null }).customer_name).toBe("Ana");
    expect(checkoutOrderRow({ ...base, diner: "x".repeat(65) }).diner).toBeNull();
    expect(checkoutOrderRow({ ...base, diner: 42 }).diner).toBeNull();
  });

  it("records our fee in money and says where a discount came from", () => {
    expect(checkoutOrderRow(base).platform_fee).toBe(5);
    expect(checkoutOrderRow(base).promo_detail).toBeNull();
    const discounted = { ...pricing, discount: 8, itemDiscount: 3, promoDiscount: 0, couponDiscount: 5 };
    expect(checkoutOrderRow({ ...base, pricing: discounted }).promo_detail).toEqual({ item: 3, promos: 0, coupon: 5 });
  });
});

describe("how a refused cart is answered", () => {
  it("hands back vanished extras by id so the cart can drop them and retry", async () => {
    const res = await refuseCart({ kind: "removedExtras", ids: ["x"], names: ["Queso"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ removedExtraIds: ["x"], removedExtraNames: ["Queso"] });
  });

  it("points at the dish that cannot be sold, and adds nothing to a size refusal", async () => {
    const gone = await refuseCart({ kind: "unavailable", name: "Taco", itemId: "t" });
    expect(gone.status).toBe(400);
    expect(await gone.json()).toMatchObject({ unavailableItemId: "t" });
    const big = await (await refuseCart({ kind: "tooManyLines", limit: 90 })).json();
    expect(Object.keys(big)).toEqual(["error"]);
  });

  it("names the first dish that ran short and how many are really left", async () => {
    const res = await refuseShortStock([{ itemId: "t", name: "Taco", available: 2 }]);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Taco");
    expect(body.shortStock).toEqual([{ itemId: "t", available: 2 }]);
  });
});

describe("pricing a cart from the database", () => {
  const taco = { itemId: "t", name: "Taco", price: 1, qty: 1 } as unknown as OrderLineItem;
  const fakeDb = (rows: unknown[] | null, error: unknown = null) => {
    const calls: unknown[][] = [];
    const query = {
      select: () => query,
      in: (...a: unknown[]) => (calls.push(["in", ...a]), query),
      eq: (...a: unknown[]) => (calls.push(["eq", ...a]), Promise.resolve({ data: rows, error })),
    };
    return { db: { from: () => query } as never, calls };
  };
  const input = { items: [taco], promotions: [], onOpenMenu: () => true };

  it("refuses an oversized cart before asking the database anything", async () => {
    const { db, calls } = fakeDb([]);
    const r = await verifiedLines(db, "r", { ...input, maxLines: 0 });
    expect(r).toEqual({ ok: false, rejection: { kind: "tooManyLines", limit: 0 } });
    expect(calls).toEqual([]);
  });

  it("reads only this restaurant's dishes, and says so when it cannot read them", async () => {
    const { db, calls } = fakeDb(null, { message: "down" });
    expect(await verifiedLines(db, "r", input)).toEqual({ ok: false, rejection: null });
    expect(calls).toContainEqual(["eq", "restaurant_id", "r"]);
  });

  it("prices from the row, not from what the phone said", async () => {
    const row = { id: "t", name: "Taco", price: 45, emoji: "🌮", available: true, discount_pct: 0, modifiers: null, category_id: null, skips_kitchen: false };
    const r = await verifiedLines(fakeDb([row]).db, "r", input);
    expect(r.ok && r.lines[0].price).toBe(45);
  });
});
