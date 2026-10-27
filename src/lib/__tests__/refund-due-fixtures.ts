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
  currency?: string | null;
  stripe_account_id?: string | null;
  fee_reconciled_at?: string | null;
  fee_verification_pending?: boolean;
  fee_target_cents?: number;
  fee_request?: { fee_id: string; amount: number } | null;
}

export const feeVerification = vi.fn();

/** Just enough of the admin client for the two tables this touches. */
export function fakeDb(rows: Row[], stripeAccount: string | null = "acct_1") {
  let attempt: { id: string; attempt_no: number; idempotency_key: string; provider_status?: string; stripe_refund_id?: string } | null = null;
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "refund_fee_epoch") return { data: 0, error: null };
      if (name === "save_refund_due_fee_target") {
        const row = rows.find(r => r.id === args.p_due && r.restaurant_id === args.p_restaurant);
        if (row) row.fee_target_cents = Math.max(Number(row.fee_target_cents ?? 0), Number(args.p_target));
        return { data: Boolean(row), error: null };
      }
      if (name === "verify_refunded_platform_fee_v2") {
        const refunds = args.p_refunds;
        for (const row of rows) if (row.restaurant_id === args.p_restaurant && row.stripe_payment_intent === args.p_intent
          && row.refunded_at && (refunds === null || Array.isArray(refunds) && refunds.includes(row.stripe_refund_id))) {
          row.fee_target_cents = Number(args.p_target);
          row.fee_verification_pending = Number(args.p_cents) < Number(args.p_target);
          row.fee_reconciled_at = row.fee_verification_pending ? null : "2026-10-27T12:00:00Z";
        }
        return { data: true, error: null };
      }
      const row = rows.find(r => r.id === args.p_due && r.restaurant_id === args.p_restaurant);
      if (!row) return { data: null, error: null };
      if (name === "start_refund_due_fee_v2") {
        row.fee_request ??= { fee_id: String(args.p_fee), amount: Number(args.p_amount) };
        return { data: row.fee_request, error: null };
      }
      if (name === "start_refund_due_attempt") {
        if (!stripeAccount && !row.stripe_account_id && !attempt) return { data: null, error: null };
        if (!attempt || ["failed", "canceled"].includes(attempt.provider_status ?? "")) {
          const no = (attempt?.attempt_no ?? 0) + 1;
          row.stripe_account_id ??= stripeAccount;
          attempt = { id: `due-attempt-${no}`, attempt_no: no, idempotency_key: `refund-due-${row.id}${no === 1 ? "" : `-${no}`}` };
        }
        return { data: { ...attempt, amount: row.amount, stripe_account_id: row.stripe_account_id,
          stripe_payment_intent: row.stripe_payment_intent }, error: null };
      }
      if (!attempt || attempt.id !== args.p_attempt) return { data: false, error: null };
      Object.assign(attempt, { provider_status: args.p_status, stripe_refund_id: args.p_refund });
      const marked = args.p_status === "succeeded" && !row.refunded_at;
      if (marked) Object.assign(row, { refunded_at: "2026-10-20T14:00:00Z", refunded_by: args.p_actor, stripe_refund_id: args.p_refund });
      return { data: marked, error: null };
    },
    from(table: string) {
      const where: Record<string, unknown> = {};
      let nullCol: string | null = null;
      let notNullCol: string | null = null;
      let patch: Partial<Row> | null = null;
      let from = 0; let to = Infinity;
      let either: (row: Row) => boolean = () => true;
      const matches = () =>
        rows.filter(
          r =>
            Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v) &&
            (!nullCol || (r as unknown as Record<string, unknown>)[nullCol] == null) &&
            (!notNullCol || (r as unknown as Record<string, unknown>)[notNullCol] != null) && either(r),
        ).slice(from, to + 1);
      const q = {
        select: () => q,
        order: () => q,
        range: (a: number, b: number) => ((from = a), (to = b), q),
        or: (filter: string) => {
          const below = /^fee_target_cents\.is\.null,fee_target_cents\.lt\.(\d+)$/.exec(filter);
          either = below
            ? r => { const t = (r as { fee_target_cents?: number | null }).fee_target_cents; return t == null || t < Number(below[1]); }
            : filter.startsWith("currency")
            ? r => !r.currency || Boolean(r.refunded_at && !r.fee_reconciled_at)
            : r => !r.refunded_at || !r.fee_reconciled_at;
          return q;
        },
        update: (p: Partial<Row>) => ((patch = p), q),
        eq: (k: string, v: unknown) => ((where[k] = v), q),
        is: (k: string) => ((nullCol = k), q),
        not: (k: string) => ((notNullCol = k), q),
        single: async () => ({ data: table === "restaurants" ? { stripe_account_id: stripeAccount } : null, error: null }),
        maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          const hit = matches();
          if (patch) for (const r of hit) Object.assign(r, patch);
          resolve({ data: hit.map(r => ({ ...r })), error: null });
        },
      };
      return q;
    },
  };
  feeVerification.mockImplementation(db.rpc);
  return db as never;
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
  const created: Stripe.Refund[] = [];
  const made = over.made?.map(r => ({ ...r, amount: r.amount ?? 12550 }));
  const feeRefunds: { metadata: { refund_due: string } }[] = [];
  let returnedFee = 0;
  const calls = {
    create: vi.fn(async (params: Stripe.RefundCreateParams) => {
      const result = await (over.create?.() ?? Promise.resolve({ id: "re_1", status: "succeeded" }));
      const refund = { amount: params.amount, metadata: params.metadata, ...result as object } as Stripe.Refund;
      created.push(refund);
      if (refund.status === "succeeded") returnedFee += Math.round(500 * (params.amount ?? 0) / 25100);
      return result;
    }),
    retrieve: vi.fn(over.retrieve),
    list: vi.fn(() => Object.assign(Promise.resolve({ data: [...made ?? [], ...created] }), {
      async *[Symbol.asyncIterator]() { yield* [...made ?? [], ...created]; },
    })),
    feeRefund: vi.fn(async (_id: string, params: { amount: number }) => {
      returnedFee += params.amount;
      feeRefunds.push({ metadata: { refund_due: "d1" } });
      return { id: "fr_1" };
    }),
    feeList: vi.fn(() => ({ async *[Symbol.asyncIterator]() { yield* feeRefunds; } })),
    intent: vi.fn(async () => ({ currency: "usd", latest_charge: { amount: 25100, application_fee: "fee_1" } })),
  };
  const client = {
    refunds: { create: calls.create, list: calls.list, retrieve: calls.retrieve },
    paymentIntents: {
      retrieve: calls.intent,
    },
    applicationFees: {
      retrieve: async () => ({ amount: 500, amount_refunded: returnedFee }),
      createRefund: calls.feeRefund,
      listRefunds: calls.feeList,
    },
  } as unknown as Stripe;
  return { client, calls };
}

export const stripeError = (code: string) => Object.assign(new Error(code), { code });
