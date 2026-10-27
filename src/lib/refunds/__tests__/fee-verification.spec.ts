import { beforeEach, expect, it, vi } from "vitest";
import { syncReturnedFee } from "../fee";
import { chargeFixture } from "./charge-contract-fixtures";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db }));
beforeEach(() => vi.clearAllMocks());
function provider() { const f = chargeFixture("mxn"); state.db = f.db; return f; }

it("finding 2: an order fee read failure cannot mark fee reconciliation complete", async () => {
  const f = provider();
  vi.mocked(f.client.paymentIntents.retrieve).mockRejectedValueOnce(new Error("Stripe unavailable"));
  await expect(syncReturnedFee(f.client, "r", "pi", "acct")).rejects.toThrow("Stripe unavailable");
  expect(f.rpc).not.toHaveBeenCalledWith("verify_refunded_platform_fee_v2", expect.anything());
});
it("finding 2: verifies the provider target and only names refunds seen as succeeded", async () => {
  const f = provider(); f.refunds[0] = { id: "re_succeeded", status: "succeeded", amount: 10000 };
  f.refunds.push({ id: "re_pending", status: "pending", amount: 10000 });
  await syncReturnedFee(f.client, "r", "pi", "acct");
  expect(f.rpc).toHaveBeenCalledWith("verify_refunded_platform_fee_v2", {
    p_restaurant: "r", p_intent: "pi", p_cents: 0, p_target: 300, p_refunds: ["re_succeeded"], p_epoch: 0,
  });
});
it("finding 2: a charge with no fee verifies zero explicitly", async () => {
  const f = provider();
  vi.mocked(f.client.paymentIntents.retrieve).mockResolvedValue({ latest_charge: { amount: 10000, application_fee: null } } as never);
  await syncReturnedFee(f.client, "r", "pi", "acct");
  expect(f.rpc).toHaveBeenCalledWith("verify_refunded_platform_fee_v2", {
    p_restaurant: "r", p_intent: "pi", p_cents: 0, p_target: 0, p_refunds: null, p_epoch: 0,
  });
});
it("keeps an order fee pending if its verified evidence cannot be saved", async () => {
  const f = provider();
  f.rpc.mockResolvedValueOnce({ error: { message: "database unavailable" } } as never);
  await expect(syncReturnedFee(f.client, "r", "pi", "acct")).rejects.toThrow("database unavailable");
});
it("audit P 2: reads the epoch before Stripe, and a verification the epoch overtook stays pending", async () => {
  const order: string[] = []; const f = provider();
  vi.mocked(f.client.paymentIntents.retrieve).mockImplementationOnce(async () => {
    order.push("stripe"); return { latest_charge: { amount: 10000, application_fee: "fee" } } as never;
  });
  f.rpc.mockImplementation(async (name: string) => {
    order.push(name);
    return name === "refund_fee_epoch" ? { data: 4, error: null } : { data: false, error: null };
  });
  await expect(syncReturnedFee(f.client, "r", "pi", "acct")).rejects.toThrow("changed while it was being verified");
  expect(order).toEqual(["refund_fee_epoch", "stripe", "verify_refunded_platform_fee_v2"]);
  expect(f.rpc).toHaveBeenLastCalledWith("verify_refunded_platform_fee_v2", expect.objectContaining({ p_epoch: 4 }));
});
it("audit P 2: an unreadable epoch never reaches Stripe", async () => {
  const f = provider(); f.rpc.mockResolvedValueOnce({ data: null, error: { message: "no epoch" } } as never);
  await expect(syncReturnedFee(f.client, "r", "pi", "acct")).rejects.toThrow("no epoch");
  expect(f.client.paymentIntents.retrieve).not.toHaveBeenCalled();
});
