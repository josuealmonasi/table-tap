import { beforeEach, expect, it, vi } from "vitest";
import { fixture, old } from "./fixtures";
import { reconcileSavedRefund, type SavedRefund } from "../refund-item";
import { recoverRefunds } from "../refunds";

vi.mock("@/lib/stripe", () => ({ stripe: {} }));
const attempt: SavedRefund = { id: "attempt", restaurant_id: "r1", due_id: "due", amount: 10, currency: "MXN",
  stripe_refund_id: "re", stripe_account_id: "acct_old", stripe_payment_intent: "pi", created_at: old,
  refunds_due: { stripe_payment_intent: "pi", stripe_account_id: "acct_old", currency: "MXN", amount: 10,
    table_label: "7", account_name: null } };
const provider = { id: "re", status: "succeeded", amount: 1000, currency: "mxn", payment_intent: "pi" };
let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); f.client.refunds.retrieve.mockResolvedValue(provider); });

it("finishes a saved duplicate-payment refund through the locked writer", async () => {
  expect(await reconcileSavedRefund(f.context, attempt)).toBe(true);
  expect(f.rpc).toHaveBeenCalledWith("finish_refund_due_attempt_v2", expect.objectContaining({
    p_restaurant: "r1", p_due: "due", p_attempt: "attempt", p_status: "succeeded",
    p_refunds: [expect.objectContaining({ id: "re", amount_cents: 1000, currency: "MXN", account: "acct_old" })],
  }));
  expect(f.client.refunds.create).not.toHaveBeenCalled();
});

it.each([{ id: "re_other" }, { amount: 999 }, { currency: "usd" }, { payment_intent: "pi_other" }, { status: "unknown" }])(
  "rejects mismatched provider evidence %j without recording any money", async patch => {
    f.client.refunds.retrieve.mockResolvedValue({ ...provider, ...patch });
    await expect(reconcileSavedRefund(f.context, attempt)).rejects.toThrow("provider evidence");
    expect(f.rpc).not.toHaveBeenCalled();
  },
);
it("rejects a changed charge account before contacting Stripe", async () => {
  await expect(reconcileSavedRefund(f.context, { ...attempt, stripe_account_id: "acct_new" })).rejects.toThrow("original charge");
  expect(f.client.refunds.retrieve).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
});

it.each(["pending", "requires_action"])("keeps Stripe's %s refund pending and never creates one", async status => {
  f.client.refunds.retrieve.mockResolvedValue({ ...provider, status });
  f.rpc.mockResolvedValue({ data: { outcome: "pending" }, error: null });
  expect(await reconcileSavedRefund(f.context, attempt)).toBe(false);
  expect(f.rpc).toHaveBeenCalledTimes(1);
  expect(f.client.refunds.create).not.toHaveBeenCalled();
});

it.each(["failed", "canceled"])("records a %s provider refund and leaves any replacement to a manager", async status => {
  f.client.refunds.retrieve.mockResolvedValue({ ...provider, status });
  await expect(reconcileSavedRefund(f.context, attempt)).rejects.toThrow("refund failed");
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["finish_refund_due_attempt_v2"]);
  expect(f.client.refunds.create).not.toHaveBeenCalled();
});

it.each(["conflict", "stale", "missing"])("does not claim completion when SQL refuses the snapshot (%s)", async outcome => {
  f.rpc.mockResolvedValue({ data: { outcome }, error: null });
  expect(await reconcileSavedRefund(f.context, attempt)).toBe(false);
  expect(f.rpc).toHaveBeenCalledTimes(1);
});

it("never discovers an attempt without a provider ID or a terminal attempt", async () => {
  f.tables.refund_due_attempts = [
    { ...attempt, stripe_refund_id: null, provider_status: "pending" },
    { ...attempt, id: "finished", provider_status: "succeeded" },
  ];
  expect(await recoverRefunds(f.context)).toMatchObject({ done: 0, pending: 0, failed: 0 });
  expect(f.client.refunds.retrieve).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
});

it("an unavailable order-refund query does not stop duplicate-payment recovery", async () => {
  f.errors.refund_attempts = "unavailable";
  f.tables.refund_due_attempts = [{ ...attempt, provider_status: "pending" }];
  f.rpc.mockImplementation(async name => {
    if (name === "finish_refund_due_attempt_v2") f.tables.refund_due_attempts = [];
    return { data: { outcome: "completed" }, error: null };
  });
  expect(await recoverRefunds(f.context)).toMatchObject({ done: 1, pending: null, failed: 1, observation_failed: true });
  expect(f.client.refunds.retrieve).toHaveBeenCalledOnce();
});

it("rings the existing refund-due bell once for that restaurant across repeated overdue sweeps", async () => {
  f.tables.refund_due_attempts = [{ ...attempt, provider_status: "pending" }];
  f.client.refunds.retrieve.mockResolvedValue({ ...provider, status: "pending" });
  f.rpc.mockResolvedValue({ data: { outcome: "pending" }, error: null });
  await recoverRefunds(f.context);
  await recoverRefunds(f.context);
  expect(f.tables.notifications).toHaveLength(1);
  expect(f.tables.notifications[0]).toMatchObject({ restaurant_id: "r1", kind: "refund_due",
    data: { amount: 10, currency: "MXN", table: "7", account: null } });
  expect(f.calls.filter(c => c.method === "upsert")[0].args[1]).toEqual({ onConflict: "id", ignoreDuplicates: true });
});
