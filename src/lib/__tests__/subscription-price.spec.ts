import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const rows: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => rows.shift() }; return q; },
}) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
const { subscriptionPlan } = await import("@/lib/subscription-price");
const sub = (id: string, plan = "servicio") => ({ id: "sub_1", metadata: { plan },
  items: { data: [{ price: { id } }] },
}) as unknown as Stripe.Subscription;
beforeEach(() => { rows.length = 0; vi.spyOn(console, "warn").mockImplementation(() => {}); });
it("D5 uses the actual registered Price when metadata names the former tier", async () => {
  rows.push({ data: { plan: "casa" }, error: null });
  await expect(subscriptionPlan(sub("price_casa"))).resolves.toBe("casa");
  expect(console.warn).toHaveBeenCalled();
});
it("D5 refuses an unknown Price instead of granting the metadata tier", async () => {
  rows.push({ data: null, error: null }, { data: null, error: null });
  await expect(subscriptionPlan(sub("price_unknown", "casa"))).rejects.toThrow("Unmapped");
});
it("D5 accepts a configured catalogue Price", async () => {
  rows.push({ data: null, error: null }, { data: { plan: "servicio" }, error: null });
  await expect(subscriptionPlan(sub("price_configured"))).resolves.toBe("servicio");
});
