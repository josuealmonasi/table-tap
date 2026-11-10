import { beforeEach, expect, it, vi } from "vitest";
import { fixture, old } from "./fixtures";

const { fee, apply } = vi.hoisted(() => ({ fee: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/refunds/charge-reconciler", () => ({ reconcileChargeFee: fee }));
vi.mock("@/lib/subscription-sync", () => ({ applySubscription: apply }));
beforeEach(() => { vi.clearAllMocks(); fee.mockResolvedValue(true); });

it("finding 4: recovers orphan stock across restaurants without a page visit", async () => {
  const { recoverStock } = await import("../stock");
  const f = fixture();
  f.tables.stock_reservations = [{ id: "orphan", restaurant_id: "r1", created_at: old, released_at: null }];
  f.rpc.mockImplementation(async () => { f.tables.stock_reservations = []; return { data: 1, error: null }; });
  const result = await recoverStock(f.context);
  expect(f.rpc).toHaveBeenCalledWith("recover_stock_reservations", {});
  expect(result).toMatchObject({ done: 1, pending: 0, failed: 0 });
});

it("finding 5: drains fees without Bills using the frozen charge account", async () => {
  const { recoverFees } = await import("../fees");
  const f = fixture();
  f.tables.fee_reconcile_queue = [{ restaurant_id: "r1", stripe_payment_intent: "pi", enqueued_at: old }];
  f.tables.refund_operations = [{ restaurant_id: "r1", stripe_payment_intent: "pi", stripe_account_id: "acct_old" }];
  fee.mockImplementation(async () => { f.tables.fee_reconcile_queue = []; return true; });
  expect(await recoverFees(f.context)).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(fee).toHaveBeenCalledWith(f.context.db, f.context.client, "r1", "pi", "acct_old");
});

it("finding 3: verifies a saved provider refund without starting or creating one", async () => {
  const { recoverRefunds } = await import("../refunds");
  const f = fixture();
  f.tables.refund_attempts = [{ id: "attempt", restaurant_id: "r1", operation_id: "op", origin: "app",
    amount: 10, stripe_refund_id: "re", stripe_account_id: "acct_old", stripe_payment_intent: "pi",
    provider_status: "pending", created_at: old, refund_operations: { id: "op", source: "stripe", status: "processing", currency: "MXN",
      stripe_account_id: "acct_old", stripe_payment_intent: "pi" } }];
  f.client.refunds.retrieve.mockResolvedValue({ id: "re", status: "succeeded", amount: 1000, currency: "mxn", payment_intent: "pi" });
  f.rpc.mockImplementation(async () => { f.tables.refund_attempts = []; return { data: { outcome: "completed" }, error: null }; });
  expect(await recoverRefunds(f.context)).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(f.client.refunds.retrieve).toHaveBeenCalledWith("re", { stripeAccount: "acct_old" });
  expect(f.client.refunds.create).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenCalledWith("finish_refund_operation_v2", expect.objectContaining({ p_attempt: "attempt", p_operation: "op" }));
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["finish_refund_operation_v2", "enqueue_fee_reconcile"]);
});

it("finding 6: refreshes locked subscriptions through the webhook transition", async () => {
  const { recoverSubscriptions } = await import("../subscriptions");
  const f = fixture();
  f.tables.restaurants = [{ id: "r1", plan_status: "locked", stripe_subscription_id: "sub", created_at: old }];
  const sub = { id: "sub", status: "active", metadata: { restaurant_id: "r1" } };
  f.client.subscriptions.retrieve.mockResolvedValue(sub);
  apply.mockImplementation(async () => { f.tables.restaurants = []; });
  expect(await recoverSubscriptions(f.context)).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(apply).toHaveBeenCalledWith(sub, f.context.db, f.context.client, "sub");
});

it("finding 7: reports the oldest remaining fee and continues after another charge fails", async () => {
  const { recoverFees } = await import("../fees");
  const f = fixture();
  f.tables.fee_reconcile_queue = ["bad", "good"].map(id => ({ restaurant_id: id, stripe_payment_intent: id, enqueued_at: old }));
  f.tables.fee_returns = ["bad", "good"].map(id => ({ id, restaurant_id: id, stripe_payment_intent: id, stripe_account_id: "acct" }));
  fee.mockImplementation(async (_db, _stripe, restaurant) => {
    if (restaurant === "bad") throw new Error("Stripe offline");
    f.tables.fee_reconcile_queue = f.tables.fee_reconcile_queue.filter(r => r.restaurant_id !== "good");
    return true;
  });
  const result = await recoverFees(f.context);
  expect(result).toMatchObject({ done: 1, pending: 1, failed: 1, oldest_pending_at: old });
  expect(result.oldest_pending_age_seconds).toBeGreaterThan(6 * 3600);
  expect(f.from.mock.calls.some(([table]) => table === "notifications")).toBe(false);
});
