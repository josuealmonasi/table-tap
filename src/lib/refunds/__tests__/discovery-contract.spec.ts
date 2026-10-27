import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { chargeFixture } from "./charge-contract-fixtures";
const state = vi.hoisted(() => ({ db: null as unknown, client: null as unknown, event: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db }));
vi.mock("@/lib/stripe", () => ({ get stripe() { return state.client; } }));
vi.mock("@/lib/stripe-webhook", () => ({ readStripeEvent: async () => ({ event: state.event }) }));
vi.mock("@/lib/checkout-settle", () => ({ abandonCheckout: vi.fn(), settleCheckout: vi.fn() }));
vi.mock("@/lib/stripe-connect", () => ({ syncConnectAccount: vi.fn() }));
import { POST } from "@/app/api/webhooks/stripe/connect/route";
import { recoverOrderRefundFees } from "../operations";
beforeEach(() => vi.clearAllMocks());

describe.each(["mxn", "usd"])("manual refund discovery in %s", currency => {
  function setup(type = "refund.created", status = "succeeded") {
    const f = chargeFixture(currency); state.client = f.client;
    state.db = f.db;
    state.event = { type, account: "acct", data: { object: { id: "re_manual", status, currency, payment_intent: "pi" } } };
    return f;
  }
  it.each(["refund.created", "refund.updated", "charge.refunded"])("%s enqueues before 200", async type => {
    const f = setup(type);
    const response = await POST(new NextRequest("https://tabletap.test/api/webhooks/stripe/connect", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(f.rpc).toHaveBeenCalledWith("enqueue_fee_reconcile", { p_restaurant: "r", p_intent: "pi" });
  });
  it("a manual Stripe refund after reconciliation is discovered and repaid", async () => {
    const f = setup(); f.returned = 180;
    f.refunds.push({ id: "re_manual", status: "succeeded", amount: 4000 });
    await POST(new NextRequest("https://tabletap.test/api/webhooks/stripe/connect", { method: "POST" }));
    await recoverOrderRefundFees("r", "fee recovery");
    expect(f.createRefund).toHaveBeenCalledWith("fee", { amount: 120, metadata: { fee_return: "request-1" } }, { idempotencyKey: "fee-key-1" });
    expect(f.returned).toBe(300); expect(f.generation).toBeNull();
  });
  it("an enqueue error prevents webhook acknowledgement", async () => {
    const f = setup(); const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => name === "enqueue_fee_reconcile" ? { data: null, error: { message: "offline" } } as never : original(name, args));
    await expect(POST(new NextRequest("https://tabletap.test/api/webhooks/stripe/connect", { method: "POST" }))).rejects.toThrow("offline");
  });
  it("a pending refund does not enqueue success", async () => {
    const f = setup("refund.updated", "pending");
    await POST(new NextRequest("https://tabletap.test/api/webhooks/stripe/connect", { method: "POST" }));
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
