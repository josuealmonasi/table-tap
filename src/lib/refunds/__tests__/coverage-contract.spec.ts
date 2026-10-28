import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { refundDue } from "@/lib/refund-due";
import { fullyReturnedCharge } from "../due-provider";
import { due, fakeDb, fakeStripe, stripeError } from "@/lib/__tests__/refund-due-fixtures";
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("../due-recovery", () => ({ reconcileDueFee: vi.fn(async () => true), verifyDueCurrency: vi.fn(async () => "USD") }));

describe.each(["mxn", "usd"])("duplicate coverage in %s", currency => {
  it("partial coverage, then failure of a contributing refund, stays owed", async () => {
    const rows = [due({ amount: 100, currency: currency.toUpperCase() })];
    const db = fakeDb(rows) as ReturnType<typeof createAdminClient>;
    const original = db.rpc.bind(db);
    const seen: unknown[] = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      // Untagged refunds are the restaurant's own, recorded first (paths audit
      // #7); the same late failure leaves that recording partial too.
      if (name === "record_refund_due_coverage_v1") return { data: { outcome: "partial", outstanding_cents: 6000 }, error: null };
      if (name !== "finish_refund_due_attempt_v2") return original(name, args);
      seen.push(args.p_refunds);
      // A late failure of re60 makes only re40 active at completion.
      return { data: { outcome: "partial", outstanding_cents: 6000 }, error: null };
    });
    const refunds = [{ id: "re60", status: "succeeded", amount: 6000 }, { id: "re40", status: "succeeded", amount: 4000 }] as Stripe.Refund[];
    const { client, calls } = fakeStripe({ made: refunds, create: async () => { throw stripeError("charge_already_refunded"); } });
    calls.intent.mockResolvedValue({ currency, latest_charge: { amount: 10000, application_fee: "fee" } });
    const answer = await refundDue({ ...db, rpc } as never, "r1", "d1", "manager", client);
    expect(answer).toMatchObject({ ok: false, error: "apiErr.refundPending", status: 409 });
    expect(seen).toEqual([[{ id: "re60", amount_cents: 6000 }, { id: "re40", amount_cents: 4000 }]]);
    expect(rows[0].refunded_at).toBeNull();
  });
  it("fully returned fallback retains every succeeded refund and amount", async () => {
    const refunds = [{ id: "re60", status: "succeeded", amount: 6000 }, { id: "re_pending", status: "pending", amount: 9999 },
      { id: "re40", status: "succeeded", amount: 4000 }] as Stripe.Refund[];
    const { client, calls } = fakeStripe({ made: refunds });
    calls.intent.mockResolvedValue({ currency, latest_charge: { amount: 10000, application_fee: "fee" } });
    expect(await fullyReturnedCharge(client, "pi", "acct")).toEqual([{ id: "re60", amount_cents: 6000 }, { id: "re40", amount_cents: 4000 }]);
  });
  it.each(["partial", "failed"])("never reports a %s finish as refunded", async outcome => {
    const db = fakeDb([due({ currency: currency.toUpperCase() })]) as ReturnType<typeof createAdminClient>; const original = db.rpc.bind(db);
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === "finish_refund_due_attempt_v2"
      ? { data: { outcome, outstanding_cents: 12550 }, error: null } : original(name, args));
    const { client } = fakeStripe({ create: async () => ({ id: "re_1", amount: 12550, status: "succeeded" }) });
    expect(await refundDue({ ...db, rpc } as never, "r1", "d1", "manager", client)).toMatchObject({ ok: false, error: "apiErr.refundPending" });
    expect(rpc).toHaveBeenCalledWith("finish_refund_due_attempt_v2", expect.objectContaining({ p_refunds: [{ id: "re_1", amount_cents: 12550 }] }));
  });
});

it.each(["MXN", "USD"])("%s retains coverage over partial completion, a contributing failure and retries", async currency => {
  const rows = [due({ amount: 100, currency })];
  const base = fakeDb(rows) as ReturnType<typeof createAdminClient>;
  const coverage = new Map([["re60", 6000]]);
  let attemptNo = 0;
  let outstanding = 4000;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "start_refund_due_attempt" || name === "start_refund_due_attempt_v2") return { data: { id: `a${++attemptNo}`, attempt_no: attemptNo,
      amount: outstanding / 100, idempotency_key: `key${attemptNo}`, stripe_account_id: "acct", stripe_payment_intent: "pi" }, error: null };
    if (name === "finish_refund_due_attempt_v2") {
      for (const r of args.p_refunds as { id: string; amount_cents: number }[]) coverage.set(r.id, r.amount_cents);
      outstanding = 10000 - [...coverage.values()].reduce((a, b) => a + b, 0);
      return { data: { outcome: outstanding > 0 ? "partial" : "completed", outstanding_cents: outstanding, marked: outstanding <= 0 }, error: null };
    }
    throw Error(name);
  });
  const { client, calls } = fakeStripe({ create: async () => ({ id: `retry${attemptNo}`, amount: outstanding, status: "succeeded" }) });
  // While the 40 retry is in flight, the 60 that previously covered it fails.
  const create = calls.create.getMockImplementation()!;
  calls.create.mockImplementationOnce(async (...args) => { const made = await create(...args); coverage.delete("re60"); return made; });
  const db = { ...base, rpc } as never;
  expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ error: "apiErr.refundPending" });
  expect(outstanding).toBe(6000);
  expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ ok: true });
  // The other contributing refund can still fail after that completion.
  coverage.delete("retry1"); outstanding = 4000;
  expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ ok: true });
  expect(calls.create.mock.calls.map(([params]) => params.amount)).toEqual([4000, 6000, 4000]);
  expect([...coverage.keys()]).toEqual(["retry2", "retry3"]);
});

it("retains a pending provider id without counting it as successful coverage", async () => {
  const base = fakeDb([due({ currency: "USD" })]) as ReturnType<typeof createAdminClient>;
  let providerId: string | null = null;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "start_refund_due_attempt" || name === "start_refund_due_attempt_v2") return { data: { id: "a1", attempt_no: 1, amount: 125.5,
      idempotency_key: "key1", stripe_account_id: "acct", stripe_payment_intent: "pi", stripe_refund_id: providerId }, error: null };
    const evidence = args.p_refunds as { id: string; amount_cents: number }[];
    providerId = evidence[0].id;
    return { data: { outcome: args.p_status === "succeeded" ? "completed" : "failed", outstanding_cents: 0, marked: true }, error: null };
  });
  const { client, calls } = fakeStripe({ create: async () => ({ id: "re_wait", status: "pending", amount: 12550 }),
    retrieve: async () => ({ id: "re_wait", status: "succeeded", amount: 12550 }) });
  const db = { ...base, rpc } as never;
  expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ error: "apiErr.refundPending" });
  expect(providerId).toBe("re_wait");
  expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ ok: true });
  expect(calls.create).toHaveBeenCalledTimes(1); expect(calls.retrieve).toHaveBeenCalledWith("re_wait", { stripeAccount: "acct" });
  expect(rpc).toHaveBeenCalledWith("finish_refund_due_attempt_v2", expect.objectContaining({
    p_refunds: [{ id: "re_wait", amount_cents: 12550 }], p_status: "pending",
  }));
});
