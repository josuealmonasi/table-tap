import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const retrieve = vi.fn();
const patches: Record<string, unknown>[] = [];
vi.mock("@/lib/stripe", () => ({ stripe: { subscriptions: { retrieve: (...a: unknown[]) => retrieve(...a) } } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async () => ({ data: 1, error: null }),
  from: (table: string) => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === "restaurants"
        ? { stripe_subscription_id: "sub_1", subscription_sync_revision: 0 }
        : { plan: "casa" }, error: null }),
      update: (patch: Record<string, unknown>) => { patches.push(patch); return q; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "r1" }], error: null }).then(resolve),
    }; return q;
  },
}) }));
const { applySubscription } = await import("@/lib/subscription-sync");
const subscription = { id: "sub_1", status: "active", metadata: { restaurant_id: "r1", plan: "servicio" },
  items: { data: [{ price: { id: "price_casa", unit_amount: 149900 } }] },
} as unknown as Stripe.Subscription;
beforeEach(() => {
  patches.length = 0; retrieve.mockResolvedValue(subscription);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
it("D5 sync grants the purchased Price tier when subscription metadata is stale", async () => {
  await applySubscription(subscription);
  expect(patches[0]).toMatchObject({ plan: "casa", plan_status: "active" });
});
