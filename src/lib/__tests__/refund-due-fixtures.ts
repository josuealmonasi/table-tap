import { vi } from "vitest";
import type Stripe from "stripe";

export interface Row {
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
export function fakeDb(rows: Row[], stripeAccount: string | null = "acct_1") {
  let attempt: { id: string; attempt_no: number; idempotency_key: string; provider_status?: string; stripe_refund_id?: string } | null = null;
  return {
    rpc: async (name: string, args: Record<string, string>) => {
      const row = rows.find(r => r.id === args.p_due && r.restaurant_id === args.p_restaurant);
      if (!row) return { data: null, error: null };
      if (name === "start_refund_due_attempt") {
        if (!stripeAccount) return { data: null, error: null };
        if (!attempt || ["failed", "canceled"].includes(attempt.provider_status ?? "")) {
          const no = (attempt?.attempt_no ?? 0) + 1;
          attempt = { id: `due-attempt-${no}`, attempt_no: no, idempotency_key: `refund-due-${row.id}${no === 1 ? "" : `-${no}`}` };
        }
        return { data: { ...attempt, amount: row.amount, stripe_account_id: stripeAccount,
          stripe_payment_intent: row.stripe_payment_intent }, error: null };
      }
      if (attempt?.id !== args.p_attempt) return { data: false, error: null };
      Object.assign(attempt, { provider_status: args.p_status, stripe_refund_id: args.p_refund });
      const marked = args.p_status === "succeeded" && !row.refunded_at;
      if (marked) Object.assign(row, { refunded_at: "2026-10-20T14:00:00Z", refunded_by: args.p_actor, stripe_refund_id: args.p_refund });
      return { data: marked, error: null };
    },
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

export const due = (over: Partial<Row> = {}): Row => ({
  id: "d1",
  restaurant_id: "r1",
  stripe_payment_intent: "pi_1",
  amount: 125.5,
  table_label: "4",
  refunded_at: null,
  ...over,
});

export function fakeStripe(over: { create?: () => Promise<unknown>; made?: Stripe.Refund[]; retrieve?: () => Promise<unknown> } = {}) {
  const calls = {
    create: vi.fn(over.create ?? (async () => ({ id: "re_1", status: "succeeded" }))),
    retrieve: vi.fn(over.retrieve),
    list: vi.fn(() => Object.assign(Promise.resolve({ data: over.made ?? [] }), {
      async *[Symbol.asyncIterator]() { yield* over.made ?? []; },
    })),
    feeRefund: vi.fn(async () => ({ id: "fr_1" })),
  };
  const client = {
    refunds: { create: calls.create, list: calls.list, retrieve: calls.retrieve },
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

export const stripeError = (code: string) => Object.assign(new Error(code), { code });

