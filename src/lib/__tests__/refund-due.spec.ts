import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const logged: { action: string; detail?: string | null }[] = [];
vi.mock("@/lib/activity-log", () => ({
  logEvent: async (e: { action: string; detail?: string | null }) => void logged.push(e),
}));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));

import { corteFrom } from "@/lib/corte";
import { refundDue, refundDueLogDetail } from "@/lib/refund-due";

interface Row {
  id: string;
  restaurant_id: string;
  stripe_payment_intent: string;
  amount: number;
  table_label: string | null;
  refunded_at: string | null;
  refunded_by?: string | null;
  stripe_refund_id?: string | null;
}

/** Just enough of the admin client for the two tables this touches. */
function fakeDb(rows: Row[], stripeAccount: string | null = "acct_1") {
  return {
    from(table: string) {
      const where: Record<string, unknown> = {};
      let nullCol: string | null = null;
      let patch: Partial<Row> | null = null;
      const matches = () =>
        rows.filter(
          r =>
            Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v) &&
            (!nullCol || (r as unknown as Record<string, unknown>)[nullCol] == null),
        );
      const q = {
        select: () => q,
        update: (p: Partial<Row>) => ((patch = p), q),
        eq: (k: string, v: unknown) => ((where[k] = v), q),
        is: (k: string) => ((nullCol = k), q),
        single: async () => ({ data: table === "restaurants" ? { stripe_account_id: stripeAccount } : null, error: null }),
        maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          const hit = matches();
          if (patch) for (const r of hit) Object.assign(r, patch);
          resolve({ data: hit.map(r => ({ id: r.id })), error: null });
        },
      };
      return q;
    },
  } as never;
}

const due = (over: Partial<Row> = {}): Row => ({
  id: "d1",
  restaurant_id: "r1",
  stripe_payment_intent: "pi_1",
  amount: 125.5,
  table_label: "4",
  refunded_at: null,
  ...over,
});

function fakeStripe(over: { create?: () => Promise<unknown>; made?: Stripe.Refund[] } = {}) {
  const calls = {
    create: vi.fn(over.create ?? (async () => ({ id: "re_1" }))),
    list: vi.fn(async () => ({ data: over.made ?? [] })),
    feeRefund: vi.fn(async () => ({ id: "fr_1" })),
  };
  const client = {
    refunds: { create: calls.create, list: calls.list },
    paymentIntents: {
      retrieve: async () => ({ latest_charge: { amount: 25100, application_fee: "fee_1" } }),
    },
    applicationFees: {
      retrieve: async () => ({ amount: 500, amount_refunded: 0 }),
      createRefund: calls.feeRefund,
    },
  } as unknown as Stripe;
  return { client, calls };
}

const stripeError = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  logged.length = 0;
});

describe("refunding a payment taken twice", () => {
  it("refunds the amount taken twice from the restaurant's account, with our fee", async () => {
    const rows = [due()];
    const { client, calls } = fakeStripe();
    const answer = await refundDue(fakeDb(rows), "r1", "d1", "ana@x.dev", client);
    expect(answer).toEqual({ ok: true, amount: 125.5, alreadyInStripe: false });
    expect(calls.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 12550, refund_application_fee: true, metadata: { refund_due: "d1" } },
      { idempotencyKey: "refund-due-d1", stripeAccount: "acct_1" },
    );
    expect(rows[0]).toMatchObject({ refunded_by: "ana@x.dev", stripe_refund_id: "re_1" });
    expect(rows[0].refunded_at).toBeTruthy();
    expect(logged).toHaveLength(1);
  });

  it("leaves the row owed when Stripe refuses, so it can be tried again", async () => {
    const rows = [due()];
    const { client } = fakeStripe({ create: async () => Promise.reject(stripeError("card_declined")) });
    const answer = await refundDue(fakeDb(rows), "r1", "d1", "ana@x.dev", client);
    expect(answer).toEqual({ ok: false, error: "apiErr.refundDueFailed", status: 502 });
    expect(rows[0].refunded_at).toBeNull();
    expect(logged).toHaveLength(0);
  });

  it("never refunds twice: a refund Stripe already made for this row is reused", async () => {
    // The server died after Stripe refunded and before the row was written.
    const rows = [due()];
    const { client, calls } = fakeStripe({
      made: [{ id: "re_old", metadata: { refund_due: "d1" } } as unknown as Stripe.Refund],
    });
    const answer = await refundDue(fakeDb(rows), "r1", "d1", "ana@x.dev", client);
    expect(answer.ok).toBe(true);
    expect(calls.create).not.toHaveBeenCalled();
    expect(rows[0].stripe_refund_id).toBe("re_old");
  });

  it("returns our fee when the diner was already refunded by hand in Stripe", async () => {
    const rows = [due({ amount: 251 })];
    const { client, calls } = fakeStripe({ create: async () => Promise.reject(stripeError("charge_already_refunded")) });
    const answer = await refundDue(fakeDb(rows), "r1", "d1", "ana@x.dev", client);
    expect(answer).toEqual({ ok: true, amount: 251, alreadyInStripe: true });
    // The whole charge was taken twice, so the whole fee goes back.
    expect(calls.feeRefund).toHaveBeenCalledWith(
      "fee_1",
      { amount: 500, metadata: { refund_due: "d1" } },
      { idempotencyKey: "refund-due-fee-d1" },
    );
    expect(rows[0].refunded_at).toBeTruthy();
  });

  it("refuses one already refunded, another restaurant's, or one with no Stripe account", async () => {
    const { client, calls } = fakeStripe();
    expect(await refundDue(fakeDb([due({ refunded_at: "2026-10-03" })]), "r1", "d1", "a", client)).toMatchObject({ status: 409 });
    expect(await refundDue(fakeDb([due()]), "r2", "d1", "a", client)).toMatchObject({ status: 404 });
    expect(await refundDue(fakeDb([due()], null), "r1", "d1", "a", client)).toMatchObject({
      error: "apiErr.refundNeedsStripe",
    });
    expect(calls.create).not.toHaveBeenCalled();
  });

  it("answers the second of two clicks without a second refund", async () => {
    const rows = [due()];
    const { client } = fakeStripe({ create: async () => Promise.reject(stripeError("idempotency_key_in_use")) });
    expect(await refundDue(fakeDb(rows), "r1", "d1", "a", client)).toMatchObject({ error: "apiErr.alreadyRefunded" });
    expect(rows[0].refunded_at).toBeNull();
  });
});

describe("the corte and a refund due", () => {
  it("does not take a refund due out of the day's takings, which never counted it", () => {
    // A double payment is kept out of the ledger, so the corte never had it.
    const card = { actor_email: null, amount: 90, method: "card" };
    const corte = corteFrom([card], [{ action: "refunded", detail: refundDueLogDetail(90, "4") }]);
    expect(corte.online).toBe(90);
  });
});
