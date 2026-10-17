import { beforeEach, expect, it, vi } from "vitest";
import type { PlanLimits } from "@/lib/plan";

const retrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({ stripe: { prices: { retrieve: (...a: unknown[]) => retrieve(...a) } } }));
const { checkoutPrice } = await import("@/lib/billing-price");
const limits: PlanLimits = {
  plan: "casa", rank: 3, monthly_price: 1499, order_fee: 0.75,
  max_tables: null, max_staff: null, max_menus: null, max_items: null,
  allows_dine_in: true, allows_promotions: true, allows_coupons: true,
  allows_staff_discounts: true, analytics_days: 365, log_days: 365, stripe_price_id: "price_mxn",
};
beforeEach(() => {
  vi.resetAllMocks();
  retrieve.mockResolvedValue({ id: "price_mxn", currency: "mxn", active: true,
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
