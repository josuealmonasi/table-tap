import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const update = vi.fn();
const retrieve = vi.fn();
const patches: Record<string, unknown>[] = [];
const rpc = vi.fn();
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r1" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/stripe", () => ({ stripe: { subscriptions: {
  update: (...a: unknown[]) => update(...a), retrieve: (...a: unknown[]) => retrieve(...a),
} } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (...a: unknown[]) => rpc(...a),
  from: () => {
    const q = {
      select: () => q, eq: () => q,
      single: async () => ({ data: { stripe_subscription_id: "sub_1" }, error: null }),
      maybeSingle: async () => ({ data: { stripe_subscription_id: "sub_1", subscription_sync_revision: 0 }, error: null }),
      update: (patch: Record<string, unknown>) => { patches.push(patch); return q; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "r1" }], error: null }).then(resolve),
    }; return q;
  },
}) }));
const { POST } = await import("@/app/api/billing/cancel/route");
const run = () => POST(new Request("https://tabletap.test/api/billing/cancel", {
  method: "POST", body: JSON.stringify({ resume: false }),
}));
beforeEach(() => {
  vi.resetAllMocks(); patches.length = 0;
  rpc.mockResolvedValue({ data: true, error: null });
  const sub = { id: "sub_1", status: "active", metadata: { restaurant_id: "r1", plan: "casa" },
    items: { data: [{ current_period_end: 1800000000, price: { unit_amount: 149900 } }] } };
  update.mockResolvedValue({ ...sub, cancel_at_period_end: true });
  // A portal resume overtook the cancellation response.
  retrieve.mockResolvedValue({ ...sub, cancel_at_period_end: false });
});
it("does not overwrite a newer portal resume with an older cancellation response", async () => {
  expect((await run()).status).toBe(200);
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({ plan_ends_at: null, subscribed_price: 1499, subscription_sync_revision: 1 });
});
