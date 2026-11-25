import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// An abandoned pay-now page used to leave a settled table's sitting open: the
// pending order refused the close, then was deleted, and nothing closed again.
const close = vi.hoisted(() => vi.fn(async () => {}));
const rpc = vi.hoisted(() => vi.fn(async () => ({ error: null as { message: string } | null })));
const state = vi.hoisted(() => ({ paidRows: [] as { id: string }[], sessionId: "s1" as string | null }));
vi.mock("@/lib/table-session", () => ({ closeSessionIfClear: close }));
vi.mock("@/lib/diner-attempt", () => ({ finishDinerCheckout: async () => {} }));
vi.mock("@/lib/diner-checkout", () => ({ verifyDinerCheckout: async () => {} }));
vi.mock("@/lib/platform-fee", () => ({ releaseSessionFee: async () => {} }));
vi.mock("@/lib/legacy-stock", () => ({ legacyStockDemand: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => {
  const q: Record<string, unknown> = {};
  q.select = q.eq = () => q;
  q.maybeSingle = async () => ({ data: { restaurant_id: "r1", session_id: state.sessionId, items: [] }, error: null });
  q.limit = async () => ({ data: state.paidRows, error: null });
  return q;
} }) }));
const { abandonCheckout } = await import("@/lib/checkout-abandon");
const context = { account: "acct_1", livemode: false };
const cart = { id: "checkout-a", payment_status: "unpaid", metadata: { order_id: "pending-order" } } as unknown as Stripe.Checkout.Session;

beforeEach(() => {
  close.mockClear();
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  state.paidRows = [];
  state.sessionId = "s1";
});

it("re-closes the sitting after the abandoned order is deleted when the table already paid", async () => {
  state.paidRows = [{ id: "paid-order" }];
  await abandonCheckout(cart, context);
  expect(close).toHaveBeenCalledWith("s1", "paid");
  expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
});

it("leaves a sitting with nothing paid open, because diners are still browsing", async () => {
  await abandonCheckout(cart, context);
  expect(close).not.toHaveBeenCalled();
});

it("never re-closes when abandon_checkout failed", async () => {
  state.paidRows = [{ id: "paid-order" }];
  rpc.mockResolvedValue({ error: { message: "boom" } });
  await expect(abandonCheckout(cart, context)).rejects.toThrow("boom");
  expect(close).not.toHaveBeenCalled();
});

it("does nothing for an order outside any sitting", async () => {
  state.sessionId = null;
  state.paidRows = [{ id: "paid-order" }];
  await abandonCheckout(cart, context);
  expect(close).not.toHaveBeenCalled();
});
