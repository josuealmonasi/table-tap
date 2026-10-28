import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ORDER, REF, returnFixture, returnRequest } from "./returns-contract-fixtures";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), retrieve: vi.fn(), manager: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => state.manager ? { restaurantId: "r1", email: "manager", role: "manager" } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/stripe", () => ({ stripe: { refunds: { retrieve: state.retrieve } } }));
import { POST } from "@/app/api/order-refunds/route";
let fixture: ReturnType<typeof returnFixture>;
const post = (body: object) => POST(new NextRequest("http://localhost/api/order-refunds", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks(); state.manager = true; fixture = returnFixture();
  state.rpc.mockImplementation(fixture.rpc); state.from.mockImplementation(fixture.from);
  fixture.tables.refund_operations = [{ id: ORDER, restaurant_id: "r1", source: "stripe", status: "pending", currency: "USD",
    stripe_account_id: "acct_original", stripe_payment_intent: "pi_original", original_collector: "cashier" }];
  state.retrieve.mockResolvedValue({ id: "re_manual", amount: 4000, currency: "usd", payment_intent: "pi_original", status: "succeeded", metadata: {} });
});
describe("the manager return boundary", () => {
  it.each([["missing", 404], ["conflict", 409], ["changed", 409], ["capacity", 409], ["review", 409], ["split", 409], ["ineligible", 409], ["invalid", 400], ["future-outcome", 503]])(
    "maps %s to %s without a second money write", async (outcome, status) => {
      state.rpc.mockResolvedValue({ data: { outcome }, error: null });
      expect((await POST(returnRequest())).status).toBe(status); expect(state.rpc).toHaveBeenCalledOnce();
    });
  it.each([{}, { amountCents: 0 }, { amountCents: 1.5 }, { reason: " " }, { ref: "invalid" }, { expected: { totalCents: 1, tipCents: 2, serviceCents: 0 } }])(
    "refuses malformed preparation %j before calling SQL", async body => {
      const response = Object.keys(body).length ? await POST(returnRequest(body)) : await post({ action: "prepare" });
      expect(response.status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
    });
  it("refuses duplicate corrections even on the old execution door", async () => {
    expect((await post({ id: ORDER, dueId: "duplicate" })).status).toBe(409); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("does not issue money RPCs without a current manager", async () => {
    state.manager = false; expect((await POST(returnRequest())).status).toBe(403);
    expect(state.from).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("reports failed SQL reads as unavailable", async () => {
    state.rpc.mockRejectedValue(new Error("offline")); expect((await POST(returnRequest())).status).toBe(503);
  });
  it.each(["cash", "terminal"])("confirms %s from the original drawer and replays with the v2 finisher", async source => {
    fixture.tables.refund_operations[0].source = source;
    state.rpc.mockResolvedValue({ data: { outcome: "completed" }, error: null });
    expect((await post({ id: ORDER, confirmReturned: true, drawer: "original" })).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("finish_refund_operation_v2", { p_restaurant: "r1", p_operation: ORDER,
      p_actor: "manager", p_refunds: [], p_status: "succeeded", p_payout: "cashier" });
    expect((await post({ id: ORDER, confirmReturned: true, drawer: "me" })).status).toBe(200);
    expect(state.rpc.mock.calls[1][1].p_payout).toBe("manager");
    expect((await post({ id: ORDER, confirmReturned: "yes", drawer: "me" })).status).toBe(400);
  });
  it("records only provider-verified manual evidence, on the original account and currency", async () => {
    state.rpc.mockResolvedValue({ data: { outcome: "partial", outstanding_cents: 6000 }, error: null });
    const response = await post({ action: "attribute", id: ORDER, refundId: "re_manual", ref: REF, amount: 999999, currency: "MXN" });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ completed: false, outstandingCents: 6000 });
    expect(state.retrieve).toHaveBeenCalledWith("re_manual", { stripeAccount: "acct_original" });
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("record_order_return_coverage_v1", { p_restaurant: "r1", p_operation: ORDER,
      p_actor: "manager", p_attribution_ref: REF, p_refunds: [{ id: "re_manual", amount_cents: 4000,
        currency: "USD", account: "acct_original", payment_intent: "pi_original", status: "succeeded" }] });
  });
  it.each([{ currency: "mxn" }, { payment_intent: "pi_other" }, { status: "pending" }, { metadata: { refund_due: "due" } }])(
    "refuses unverified manual evidence %j", async over => {
      state.retrieve.mockResolvedValue({ id: "re_manual", amount: 4000, currency: "usd", payment_intent: "pi_original", status: "succeeded", metadata: {}, ...over });
      expect((await post({ action: "attribute", id: ORDER, refundId: "re_manual", ref: REF })).status).toBe(409);
      expect(state.rpc).not.toHaveBeenCalled();
    });
});
