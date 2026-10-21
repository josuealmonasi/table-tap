import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const finish = vi.hoisted(() => vi.fn(async () => {}));
const rpc = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/diner-attempt", () => ({ finishDinerCheckout: finish }));
vi.mock("@/lib/diner-checkout", () => ({ verifyDinerCheckout: async () => {}, requireVerifiedCheckout: () => {} }));
vi.mock("@/lib/platform-fee", () => ({ releaseSessionFee: async () => {} }));
vi.mock("@/lib/legacy-stock", () => ({ legacyStockDemand: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => {
  const q: Record<string, unknown> = {};
  q.select = q.eq = () => q;
  q.maybeSingle = async () => ({ data: { restaurant_id: "r1", items: [] }, error: null });
  return q;
} }) }));
const { abandonCheckout } = await import("@/lib/checkout-abandon");
const context = { account: "acct_1", livemode: false };
const session = (metadata: Record<string, string>) => ({ id: "checkout-a", payment_status: "unpaid", metadata }) as Stripe.Checkout.Session;
beforeEach(() => { finish.mockClear(); rpc.mockClear(); });

it("E7 replaying an old bill expiry never invokes coupon cleanup by order", async () => {
  const old = session({ settle_order_ids: "shared-order", settle_coupon: "TEN" });
  await abandonCheckout(old, context);
  await abandonCheckout(old, context);
  expect(finish.mock.calls).toEqual([[old, false], [old, false]]);
  expect(rpc).not.toHaveBeenCalled();
});
it("E7 a pay-now expiry releases its own attempt before returning pending stock", async () => {
  const cart = session({ order_id: "pending-order" });
  await abandonCheckout(cart, context);
  expect(finish).toHaveBeenCalledWith(cart, false);
  expect(rpc).toHaveBeenCalledWith("abandon_checkout", expect.objectContaining({ p_order: "pending-order", p_delete_order: true }));
});
