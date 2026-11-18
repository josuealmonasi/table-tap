import { expect, it, vi } from "vitest";

vi.mock("@/lib/plan-server", () => ({
  allPlans: async () => [{ plan: "carta", monthly_price: 0 }, { plan: "caja", monthly_price: 399 }, { plan: "casa", monthly_price: 1899 }],
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, is: () => q, order: async () => ({ error: null, data: [
    { id: "c1", plan: "casa", new_monthly_price: 2199, effective_at: "2027-01-01T06:00:00Z",
      plan_price_notices: [{ sent_at: "2026-11-18T00:00:00Z" }, { sent_at: null }, { sent_at: null }] },
  ] }) };
  return q;
} }) }));
import { adminPlanPrices } from "@/lib/admin-prices";

it("lists paid plans with their price and the next change, counting owners told", async () => {
  expect(await adminPlanPrices()).toEqual([
    { plan: "caja", monthlyPrice: 399, pending: null },
    { plan: "casa", monthlyPrice: 1899, pending: { id: "c1", newPrice: 2199, effectiveAt: "2027-01-01T06:00:00Z", queued: 3, sent: 1 } },
  ]);
});
