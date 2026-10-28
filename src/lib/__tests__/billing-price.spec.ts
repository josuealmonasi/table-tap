import { beforeEach, expect, it, vi } from "vitest";
import type { PlanLimits } from "@/lib/plan";

const register = vi.fn();
const create = vi.fn();
vi.mock("@/lib/subscription-price", () => ({ registerSubscriptionPrice: (...a: unknown[]) => register(...a) }));
const retrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({ stripe: { prices: { create: (...a: unknown[]) => create(...a), retrieve: (...a: unknown[]) => retrieve(...a) } } }));
const { checkoutPrice } = await import("@/lib/billing-price");
const limits: PlanLimits = {
  plan: "casa", rank: 3, monthly_price: 1499, order_fee: 0.75,
  max_tables: null, max_staff: null, max_menus: null, max_items: null,
  allows_dine_in: true, allows_promotions: true, allows_coupons: true,
  allows_staff_discounts: true, stripe_price_id: "price_mxn",
};
beforeEach(() => {
  vi.resetAllMocks();
  retrieve.mockResolvedValue({ id: "price_mxn", currency: "mxn", active: true, unit_amount: 149900,
    recurring: { interval: "month", interval_count: 1 } });
});
it("uses a verified monthly MXN price from the catalog", async () => {
  expect(await checkoutPrice(limits, 0)).toEqual({ price: "price_mxn", quantity: 1 });
});
it("rejects a configured Stripe price in a different currency", async () => {
  retrieve.mockResolvedValue({ currency: "usd", active: true, recurring: { interval: "month", interval_count: 1 } });
  await expect(checkoutPrice(limits, 0)).rejects.toThrow("monthly MXN");
});
it("rejects a configured price that charges every two months", async () => {
  retrieve.mockResolvedValue({ currency: "mxn", active: true, recurring: { interval: "month", interval_count: 2 } });
  await expect(checkoutPrice(limits, 0)).rejects.toThrow("monthly MXN");
});

it("registers generated founding Prices before offering checkout", async () => {
  create.mockResolvedValue({ id: "price_founder" });
  expect(await checkoutPrice({ ...limits, stripe_price_id: null }, 0)).toEqual({ price: "price_founder", quantity: 1 });
  expect(register).toHaveBeenCalledWith("price_founder", "casa");
});
it("rejects a configured price for another amount than the plan screen shows", async () => {
  // Codex's pricing review: a Price set up in Stripe for MX$1,899 would bill
  // a founder who was shown MX$1,499.
  retrieve.mockResolvedValue({ id: "price_mxn", currency: "mxn", active: true, unit_amount: 189900,
    recurring: { interval: "month", interval_count: 1 } });
  await expect(checkoutPrice(limits, 0)).rejects.toThrow("does not match the price shown");
});
