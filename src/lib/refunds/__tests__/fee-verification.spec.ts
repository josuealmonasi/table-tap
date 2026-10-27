import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { syncReturnedFee } from "../fee";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => name === "refund_fee_epoch" ? { data: 0, error: null } : { data: true, error: null });
});

function provider(applicationFee: string | null = "fee_1", returned = 0) {
  const intent = vi.fn(async () => ({ latest_charge: { amount: 10000, application_fee: applicationFee } }));
  const client = { paymentIntents: { retrieve: intent }, applicationFees: {
    retrieve: async () => ({ amount: 300, amount_refunded: returned }),
  }, refunds: { list: () => (async function* () {
    yield { id: "re_succeeded", status: "succeeded", amount: 10000 };
    yield { id: "re_pending", status: "pending", amount: 10000 };
  })() } } as unknown as Stripe;
  return { intent, client };
}

it("finding 2: an order fee read failure cannot mark fee reconciliation complete", async () => {
  const { client, intent } = provider();
  intent.mockRejectedValueOnce(new Error("Stripe unavailable"));
  await expect(syncReturnedFee(client, "r", "pi", "acct_original")).rejects.toThrow("Stripe unavailable");
  expect(rpc).not.toHaveBeenCalledWith("verify_refunded_platform_fee_v2", expect.anything());
});

it("finding 2: verifies the provider target and only names refunds seen as succeeded", async () => {
  const { client } = provider();
  await syncReturnedFee(client, "r", "pi", "acct_original");
  expect(rpc).toHaveBeenCalledWith("verify_refunded_platform_fee_v2", {
    p_restaurant: "r", p_intent: "pi", p_cents: 0, p_target: 300, p_refunds: ["re_succeeded"], p_epoch: 0,
  });
});

it("finding 2: a charge with no fee verifies zero explicitly", async () => {
  const { client } = provider(null);
  await syncReturnedFee(client, "r", "pi", "acct_original");
  expect(rpc).toHaveBeenCalledWith("verify_refunded_platform_fee_v2", {
    p_restaurant: "r", p_intent: "pi", p_cents: 0, p_target: 0, p_refunds: null, p_epoch: 0,
  });
});

it("keeps an order fee pending if its verified evidence cannot be saved", async () => {
  rpc.mockResolvedValueOnce({ error: { message: "database unavailable" } });
  await expect(syncReturnedFee(provider().client, "r", "pi", "acct")).rejects.toThrow("database unavailable");
});

it("audit P 2: reads the epoch before Stripe, and a verification the epoch overtook stays pending", async () => {
  const order: string[] = [];
  const { client, intent } = provider();
  intent.mockImplementationOnce(async () => { order.push("stripe"); return { latest_charge: { amount: 10000, application_fee: "fee_1" } }; });
  rpc.mockImplementation(async (name: string) => {
    order.push(name);
    return name === "refund_fee_epoch" ? { data: 4, error: null } : { data: false, error: null };
  });
  await expect(syncReturnedFee(client, "r", "pi", "acct")).rejects.toThrow("changed while it was being verified");
  expect(order).toEqual(["refund_fee_epoch", "stripe", "verify_refunded_platform_fee_v2"]);
  expect(rpc).toHaveBeenLastCalledWith("verify_refunded_platform_fee_v2", expect.objectContaining({ p_epoch: 4 }));
});
it("audit P 2: an unreadable epoch never reaches Stripe", async () => {
  const { client, intent } = provider();
  rpc.mockResolvedValueOnce({ data: null, error: { message: "no epoch" } });
  await expect(syncReturnedFee(client, "r", "pi", "acct")).rejects.toThrow("no epoch");
  expect(intent).not.toHaveBeenCalled();
});
