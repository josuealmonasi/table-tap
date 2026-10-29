import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const { rpc, resolve, release, create } = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn(), release: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve }));
vi.mock("@/lib/split-slots-attempt", () => ({ prepareSplitSlots: async () => {} }));
vi.mock("@/lib/diner-checkout", () => ({ recordDinerCheckout: async () => {}, stripeLiveMode: () => false }));
vi.mock("@/lib/platform-fee", () => ({ releaseFee: release, stripeRefusedOutright: () => false }));
const { openDinerAttempt, DinerAttemptRejected } = await import("@/lib/diner-attempt");
const params = { mode: "payment", metadata: { fee_id: "fee" }, expires_at: 12345 } as Stripe.Checkout.SessionCreateParams;
const quote = { restaurantId: "r1", stripeAccount: "acct_saved", currency: "MXN", amountCents: 10000,
  orderIds: ["o1"], payableIds: ["o1"], scopeKey: "scope", foodPrincipal: 100 };
const stripe = { checkout: { sessions: { create } } } as unknown as Stripe;
beforeEach(() => {
  vi.clearAllMocks(); resolve.mockResolvedValue("closed"); create.mockResolvedValue({ id: "cs_new", status: "open", url: "https://stripe.test" });
});
it.each([
  { data: { outcome: "paying" }, error: null },
  { data: null, error: { message: "checkout_scope_busy", code: "P0001" } },
])("a new checkout retries the same saved attempt after the blocking page closes (%#)", async refusal => {
  rpc.mockResolvedValueOnce(refusal).mockImplementation(async (_name: string, args: { p_record: unknown }) => ({ data: args.p_record, error: null }));
  expect((await openDinerAttempt(stripe, params, quote)).url).toBe("https://stripe.test");
  expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  expect(create).toHaveBeenCalledTimes(1);
});
it("an unverified blocking page rejects the new quote before Stripe", async () => {
  resolve.mockResolvedValue("unverified"); rpc.mockResolvedValue({ data: { outcome: "paying" }, error: null });
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toBeInstanceOf(DinerAttemptRejected);
  expect(create).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
});
