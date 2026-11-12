import { beforeEach, expect, it, vi } from "vitest";

import { fixture, notification, providerCase, tx } from "./fixtures";
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { ingestDispute } from "../ingest";
import { reconcileDispute } from "../reconcile";

beforeEach(() => vi.clearAllMocks());
it.each(["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated"])("durably ingests %s before any original-account provider read", async type => {
  const f = fixture();
  await ingestDispute(notification(type), f.db, f.stripe);
  expect(f.rpc.mock.calls[0]).toEqual(["enqueue_stripe_dispute_event", expect.objectContaining({ p_type: type, p_account: "acct_old", p_dispute: "dp", p_live: false, p_intent: "pi" })]);
  expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.client.disputes.retrieve.mock.invocationCallOrder[0]);
  expect(f.client.disputes.retrieve).toHaveBeenCalledWith("dp", { stripeAccount: "acct_old" });
  expect(f.client.balanceTransactions.retrieve).toHaveBeenCalledWith("txn_debit", { stripeAccount: "acct_old" });
  expect(f.rpc.mock.calls.find(([n]) => n === "finish_stripe_dispute_event")?.[1]).toMatchObject({
    p_case: { restaurant_id: "original", order_id: "order1", status: "under_review" },
    p_movements: [{ amount_minor: -10000, fee_minor: 1500, net_minor: -11500 }],
  });
});
it("duplicate deliveries and different notifications retain one provider transaction", async () => {
  const f = fixture();
  await ingestDispute(notification(), f.db, f.stripe);
  await ingestDispute(notification(), f.db, f.stripe);
  await ingestDispute(notification("charge.dispute.funds_withdrawn", "evt2"), f.db, f.stripe);
  expect(f.events.size).toBe(2);
  expect(f.movements.size).toBe(1);
  expect(f.client.disputes.retrieve).toHaveBeenCalledTimes(2);
});
it("a late created payload refreshes current won state without inventing reinstatement", async () => {
  const f = fixture();
  f.client.disputes.retrieve.mockResolvedValue(providerCase({ status: "won", balance_transactions: [] }));
  await ingestDispute(notification("charge.dispute.closed", "new"), f.db, f.stripe);
  await ingestDispute(notification("charge.dispute.created", "old"), f.db, f.stripe);
  expect(f.rpc.mock.calls.filter(([n]) => n === "finish_stripe_dispute_event").every(([, args]) => (args.p_case as { status: string }).status === "won")).toBe(true);
  expect(f.movements.size).toBe(0);
});
it.each(["dispute", "transactions", "transaction"])("%s read failure leaves a durable retryable inbox row", async fail => {
  const f = fixture();
  const reader = fail === "dispute" ? f.client.disputes.retrieve : fail === "transactions" ? f.client.balanceTransactions.list : f.client.balanceTransactions.retrieve;
  reader.mockRejectedValueOnce(new Error("Provider offline"));
  await ingestDispute(notification(), f.db, f.stripe);
  expect(f.events.get("evt")?.state).toBe("error");
  expect(f.movements.size).toBe(0);
  expect(await reconcileDispute(f.db, f.stripe, "evt")).toBe(true);
  expect(f.movements.size).toBe(1);
});
it("enqueue failure propagates before provider reads or acknowledgment", async () => {
  const f = fixture();
  f.rpc.mockResolvedValueOnce({ data: null, error: { message: "disk unavailable" } } as never);
  await expect(ingestDispute(notification(), f.db, f.stripe)).rejects.toThrow("inbox failed");
  expect(f.client.disputes.retrieve).not.toHaveBeenCalled();
});
it("collects separately linked adjustments across every page and de-duplicates overlap", async () => {
  const f = fixture();
  const credit = tx({ id: "txn_credit", amount: 10000, fee: -1500, net: 11500 });
  f.client.balanceTransactions.list.mockResolvedValueOnce({ data: [tx()], has_more: true }).mockResolvedValueOnce({ data: [credit], has_more: false });
  f.client.balanceTransactions.retrieve.mockImplementation(async id => id === "txn_credit" ? credit : tx());
  await ingestDispute(notification(), f.db, f.stripe);
  expect(f.movements.size).toBe(2);
  expect(f.client.balanceTransactions.list).toHaveBeenLastCalledWith({ source: "dp", limit: 100, starting_after: "txn_debit" }, { stripeAccount: "acct_old" });
});
it.each([tx({ net: 0 }), tx({ source: "dp_other" }), tx({ id: "txn_other" }), tx({ fee_details: [] }), tx({ fee_details: [{ amount: 1500, currency: "usd" }] })])("rejects malformed or unrelated provider money %j", async bad => {
  const f = fixture(); f.client.balanceTransactions.retrieve.mockResolvedValue(bad);
  await ingestDispute(notification(), f.db, f.stripe);
  expect(f.events.get("evt")?.state).toBe("error");
  expect(f.movements.size).toBe(0);
});
it("an expired or busy claim cannot write", async () => {
  const f = fixture(); f.rpc.mockResolvedValueOnce({ data: null, error: null });
  expect(await reconcileDispute(f.db, f.stripe, "evt")).toBe(false);
  expect(f.client.disputes.retrieve).not.toHaveBeenCalled();
});
it("commit failure preserves retry rather than calling the event done", async () => {
  const f = fixture(); const original = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async (name, args) => name === "finish_stripe_dispute_event" ? { data: null, error: { message: "conflict" } } as never : original(name, args));
  await ingestDispute(notification(), f.db, f.stripe);
  expect(f.events.get("evt")?.state).toBe("error");
});
it("requires account and matching mode even on signed events", async () => {
  const f = fixture(); const event = notification(); delete event.account;
  await expect(ingestDispute(event, f.db, f.stripe)).rejects.toThrow("account missing");
  const wrong = notification(); wrong.livemode = true;
  await expect(ingestDispute(wrong, f.db, f.stripe)).rejects.toThrow("Invalid dispute");
  expect(f.rpc).not.toHaveBeenCalled();
});
it("an incomplete provider page stays retryable", async () => {
  const f = fixture(); f.client.balanceTransactions.list.mockResolvedValueOnce({ data: [], has_more: true });
  await ingestDispute(notification(), f.db, f.stripe);
  expect(f.events.get("evt")?.state).toBe("error"); expect(f.movements.size).toBe(0);
});
it("a provider case from another mode cannot settle the inbox", async () => {
  const f = fixture(); f.client.disputes.retrieve.mockResolvedValue(providerCase({ livemode: true }));
  await ingestDispute(notification(), f.db, f.stripe);
  expect(f.events.get("evt")?.state).toBe("error"); expect(f.movements.size).toBe(0);
});
