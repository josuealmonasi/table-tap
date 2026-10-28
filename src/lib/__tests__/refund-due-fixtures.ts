import { vi } from "vitest";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";

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
}

export const feeVerification = vi.fn();

interface FeeReturn {
  id: string; restaurant_id: string; stripe_payment_intent: string; stripe_account_id: string;
  stripe_fee_id: string; currency: string; attempt_no: number; amount_cents: number; idempotency_key: string;
  status: "prepared" | "dispatched" | "succeeded" | "unresolved" | "superseded";
  created_at: number; claimed_at?: number; provider_fee_refund_id?: string;
}
interface Attempt {
  id: string; attempt_no: number; idempotency_key: string; amount: number;
  provider_status?: string; stripe_refund_id?: string | null;
}
interface QueueRow { restaurant_id: string; stripe_payment_intent: string; generation: number }
const ledgers = new WeakMap<Row[], ReturnType<typeof newLedger>>();
function newLedger() {
  return { attempts: new Map<string, Attempt>(), revisions: new Map<string, number>(), returns: [] as FeeReturn[],
    queue: [] as QueueRow[], failures: new Set<string>(), returned: new Map<string, number>(),
    coverage: new Map<string, Map<string, { amount_cents: number; active: boolean }>>() };
}
/** Database state survives a new client, but stays isolated from other tests. */
export function fakeLedger(rows: Row[]) {
  if (!ledgers.has(rows)) ledgers.set(rows, newLedger());
  return ledgers.get(rows)!;
}

/** Just enough of the admin client for the refund, fee and queue tables this touches. */
export function fakeDb(rows: Row[], stripeAccount: string | null = "acct_1") {
  const state = fakeLedger(rows);
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const result = (data: unknown) => ({ data, error: null });
      const request = state.returns.find(r => r.id === args.p_id && r.restaurant_id === args.p_restaurant);
      const key = JSON.stringify([args.p_restaurant, request?.stripe_payment_intent ?? args.p_intent]);
      const revision = () => state.revisions.get(key) ?? 0;
      const bump = () => { const next = revision() + 1; state.revisions.set(key, next); return next; };
      const transition = (outcome: string, change = false) => result({ outcome,
        ...(request && { request: { ...request } }), revision: change ? bump() : revision() });
      if (name === "refund_fee_epoch") return result(revision());
      if (name === "enqueue_fee_reconcile") {
        const generation = bump();
        const queued = state.queue.find(r => r.restaurant_id === args.p_restaurant && r.stripe_payment_intent === args.p_intent);
        if (queued) queued.generation = generation;
        else state.queue.push({ restaurant_id: String(args.p_restaurant), stripe_payment_intent: String(args.p_intent), generation });
        return result(generation);
      }
      if (name === "ack_fee_reconcile") {
        const index = state.queue.findIndex(r => r.restaurant_id === args.p_restaurant
          && r.stripe_payment_intent === args.p_intent && r.generation === args.p_generation);
        if (index >= 0) state.queue.splice(index, 1);
        return result(index >= 0);
      }
      if (name === "verify_refunded_platform_fee_v2") {
        if (args.p_epoch !== revision()) return result(false);
        const returned = Math.max(state.returned.get(key) ?? 0, Number(args.p_cents));
        state.returned.set(key, returned);
        const refunds = args.p_refunds;
        for (const row of rows) if (row.restaurant_id === args.p_restaurant && row.stripe_payment_intent === args.p_intent
          && row.refunded_at && (refunds === null || Array.isArray(refunds) && refunds.includes(row.stripe_refund_id))) {
          row.fee_target_cents = Math.max(row.fee_target_cents ?? 0, Number(args.p_target));
          row.fee_verification_pending = returned < row.fee_target_cents;
          row.fee_reconciled_at = row.fee_verification_pending ? null : row.fee_reconciled_at ?? new Date().toISOString();
        }
        return result(true);
      }
      if (name === "prepare_fee_return") {
        if (args.p_revision !== revision()) return transition("stale");
        const remainder = Number(args.p_target) - Number(args.p_returned);
        const open = state.returns.find(r => r.restaurant_id === args.p_restaurant && r.stripe_payment_intent === args.p_intent
          && ["prepared", "dispatched", "unresolved"].includes(r.status));
        if (open) {
          if (open.stripe_account_id !== args.p_account || open.stripe_fee_id !== args.p_fee || open.currency !== args.p_currency)
            throw new Error("fee return identity changed");
          if (open.status !== "prepared" || open.amount_cents <= remainder)
            return result({ outcome: "open", request: { ...open }, revision: revision() });
          open.status = "superseded";
        }
        if (remainder <= 0) return transition("none", Boolean(open));
        const no = 1 + Math.max(0, ...state.returns.filter(r => r.restaurant_id === args.p_restaurant
          && r.stripe_payment_intent === args.p_intent).map(r => r.attempt_no));
        const made: FeeReturn = { id: `fee-return-${state.returns.length + 1}`, restaurant_id: String(args.p_restaurant),
          stripe_payment_intent: String(args.p_intent), stripe_account_id: String(args.p_account), stripe_fee_id: String(args.p_fee),
          currency: String(args.p_currency), attempt_no: no, amount_cents: remainder,
          idempotency_key: `fee-return-${args.p_restaurant}-${args.p_intent}-${no}`, status: "prepared", created_at: Date.now() };
        state.returns.push(made);
        return result({ outcome: "prepared", request: { ...made }, revision: bump() });
      }
      if (name === "claim_fee_return") {
        if (!request) return transition("missing");
        if (args.p_revision !== revision()) return transition("stale");
        if (request.status === "dispatched" && request.created_at < Date.now() - 23 * 3600000) {
          request.status = "unresolved"; return transition("unresolved", true);
        }
        const first = request.status === "prepared";
        if (first || request.status === "dispatched" && request.claimed_at! < Date.now() - 3600000) {
          if (args.p_remainder == null || request.amount_cents > Number(args.p_remainder)) return transition(first ? "stale" : "wait");
          request.status = "dispatched"; request.claimed_at = Date.now();
          return transition(first ? "claimed" : "reclaimed", true);
        }
        return transition(request.status === "dispatched" ? "wait" : request.status);
      }
      if (name === "record_fee_return") {
        if (!request) return transition("missing");
        if (!args.p_provider_refund) throw new Error("fee return evidence required");
        if (request.status === "succeeded") {
          if (request.provider_fee_refund_id !== args.p_provider_refund) throw new Error("fee return already has different evidence");
          return transition("succeeded");
        }
        if (!["dispatched", "unresolved"].includes(request.status)) throw new Error("fee return was never sent");
        request.status = "succeeded"; request.provider_fee_refund_id = String(args.p_provider_refund);
        return transition("succeeded", true);
      }
      const row = rows.find(r => r.id === args.p_due && r.restaurant_id === args.p_restaurant);
      if (!row) return result(null);
      let attempt = state.attempts.get(row.id);
      const coverage = state.coverage.get(row.id) ?? new Map<string, { amount_cents: number; active: boolean }>();
      state.coverage.set(row.id, coverage);
      const covered = () => [...coverage.values()].filter(r => r.active).reduce((sum, r) => sum + r.amount_cents, 0);
      const outstanding = () => Math.max(0, Math.round(row.amount * 100) - covered());
      if (name === "start_refund_due_attempt") {
        if (!attempt || !row.refunded_at && (["failed", "canceled"].includes(attempt.provider_status ?? "")
          || attempt.provider_status === "succeeded" && outstanding() > 0)) {
          if (!stripeAccount && !row.stripe_account_id) return result(null);
          const no = (attempt?.attempt_no ?? 0) + 1;
          row.stripe_account_id ??= stripeAccount;
          attempt = { id: `due-${row.id}-attempt-${no}`, attempt_no: no,
            idempotency_key: `refund-due-${row.id}${no === 1 ? "" : `-${no}`}`, amount: covered() > 0 ? outstanding() / 100 : attempt?.amount ?? row.amount,
            stripe_refund_id: row.stripe_refund_id, provider_status: row.refunded_at ? "succeeded" : undefined };
          state.attempts.set(row.id, attempt);
        }
        return result({ ...attempt, stripe_account_id: row.stripe_account_id, stripe_payment_intent: row.stripe_payment_intent });
      }
      if (name === "start_refund_due_attempt_v2") {
        // As v1, but a new attempt is capped at what Stripe still has refundable (paths audit #7).
        const cap = args.p_refundable_cents as number;
        if (!Number.isSafeInteger(cap) || cap < 0) throw new Error("invalid refundable amount");
        if (!attempt || !row.refunded_at && (["failed", "canceled"].includes(attempt.provider_status ?? "")
          || attempt.provider_status === "succeeded" && outstanding() > 0)) {
          const send = Math.min(outstanding(), cap);
          if (send <= 0) return result({ outcome: "none", outstanding_cents: outstanding() });
          if (!stripeAccount && !row.stripe_account_id) return result(null);
          const no = (attempt?.attempt_no ?? 0) + 1;
          row.stripe_account_id ??= stripeAccount;
          attempt = { id: `due-${row.id}-attempt-${no}`, attempt_no: no,
            idempotency_key: `refund-due-${row.id}${no === 1 ? "" : `-${no}`}`, amount: send / 100,
            stripe_refund_id: row.stripe_refund_id, provider_status: row.refunded_at ? "succeeded" : undefined };
          state.attempts.set(row.id, attempt);
        }
        return result({ ...attempt, stripe_account_id: row.stripe_account_id, stripe_payment_intent: row.stripe_payment_intent });
      }
      if (name === "record_refund_due_coverage_v1") {
        // Manual refunds in Stripe: coverage only, never a change to our attempt.
        for (const refund of args.p_refunds as { id: string; amount_cents: number }[]) {
          if (!refund.id || !Number.isSafeInteger(refund.amount_cents) || refund.amount_cents <= 0) throw new Error("invalid refund evidence");
          const active = !state.failures.has(JSON.stringify([row.restaurant_id, refund.id]));
          const old = coverage.get(refund.id);
          coverage.set(refund.id, { amount_cents: old?.amount_cents ?? refund.amount_cents, active: (old?.active ?? true) && active });
        }
        if (outstanding() > 0) return result({ outcome: "partial", outstanding_cents: outstanding() });
        const marked = !row.refunded_at;
        if (marked) Object.assign(row, { refunded_at: new Date().toISOString(), refunded_by: args.p_actor,
          stripe_refund_id: row.stripe_refund_id ?? (args.p_refunds as { id: string }[])[0]?.id, fee_verification_pending: true });
        return result({ outcome: "completed", marked, outstanding_cents: 0 });
      }
      if (name !== "finish_refund_due_attempt_v2") throw new Error(`Unexpected RPC ${name}`);
      if (!attempt || attempt.id !== args.p_attempt) return result({ outcome: "stale" });
      const refunds = args.p_refunds as { id: string; amount_cents: number }[];
      let failed = false;
      if (args.p_status === "succeeded") for (const refund of refunds) {
        if (!refund.id || !Number.isSafeInteger(refund.amount_cents) || refund.amount_cents <= 0) throw new Error("invalid refund evidence");
        const active = !state.failures.has(JSON.stringify([row.restaurant_id, refund.id]));
        failed ||= !active;
        const old = coverage.get(refund.id);
        coverage.set(refund.id, { amount_cents: old?.amount_cents ?? refund.amount_cents, active: (old?.active ?? true) && active });
      }
      Object.assign(attempt, { provider_status: failed ? "failed" : args.p_status, stripe_refund_id: refunds[0]?.id ?? attempt.stripe_refund_id });
      if (args.p_status !== "succeeded" || failed) return result({ outcome: "failed", outstanding_cents: outstanding() });
      if (outstanding() > 0) return result({ outcome: "partial", outstanding_cents: outstanding() });
      const marked = !row.refunded_at;
      if (marked) Object.assign(row, { refunded_at: new Date().toISOString(), refunded_by: args.p_actor,
        stripe_refund_id: refunds[0].id, fee_verification_pending: true });
      return result({ outcome: "completed", marked, outstanding_cents: 0 });
    },
    from(table: string) {
      const where: Record<string, unknown> = {};
      let nullCol: string | null = null;
      let notNullCol: string | null = null;
      let patch: Partial<Row> | null = null;
      let from = 0; let to = Infinity;
      let either: (row: Row) => boolean = () => true;
      const source = table === "refunds_due" ? rows : table === "fee_returns" ? state.returns
        : table === "fee_reconcile_queue" ? state.queue : [];
      const matches = () =>
        (source as Row[]).filter(
          r =>
            Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v) &&
            (!nullCol || (r as unknown as Record<string, unknown>)[nullCol] == null) &&
            (!notNullCol || (r as unknown as Record<string, unknown>)[notNullCol] != null) && either(r),
        ).slice(from, to + 1);
      const q = {
        select: () => q,
        order: () => q,
        limit: (n: number) => ((to = n - 1), q),
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
  return db as unknown as ReturnType<typeof createAdminClient>;
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

export function fakeStripe(over: { currency?: string; create?: () => Promise<unknown>; made?: Stripe.Refund[]; retrieve?: () => Promise<unknown> } = {}) {
  const currency = over.currency ?? "usd";
  const created: Stripe.Refund[] = [];
  const made = over.made?.map(r => ({ ...r, amount: r.amount ?? 12550 }));
  const feeRefunds: { id: string; amount: number; currency: string; metadata: Record<string, string> }[] = [];
  const feeKeys = new Map<string, typeof feeRefunds[number]>();
  let returnedFee = 0;
  const calls = {
    create: vi.fn(async (params: Stripe.RefundCreateParams) => {
      const result = await (over.create?.() ?? Promise.resolve({ id: "re_1", status: "succeeded" }));
      const refund = { amount: params.amount, metadata: params.metadata, ...result as object } as Stripe.Refund;
      created.push(refund);
      if (refund.status === "succeeded") returnedFee += Math.round(500 * refund.amount / 25100);
      return refund;
    }),
    retrieve: vi.fn(async (id: string) => {
      const refund = { ...created.find(r => r.id === id), ...await over.retrieve?.() as object } as Stripe.Refund;
      const index = created.findIndex(r => r.id === id);
      if (index >= 0) created[index] = refund;
      return refund;
    }),
    list: vi.fn(() => Object.assign(Promise.resolve({ data: [...made ?? [], ...created] }), {
      async *[Symbol.asyncIterator]() { yield* [...made ?? [], ...created]; },
    })),
    feeRefund: vi.fn(async (_id: string, params: { amount: number; metadata: Record<string, string> }, options: { idempotencyKey: string }) => {
      const old = feeKeys.get(options.idempotencyKey);
      if (old) return old;
      returnedFee += params.amount;
      const refund = { id: `fr_${feeRefunds.length + 1}`, amount: params.amount, currency, metadata: params.metadata };
      feeRefunds.push(refund); feeKeys.set(options.idempotencyKey, refund);
      return refund;
    }),
    feeList: vi.fn(() => ({ async *[Symbol.asyncIterator]() { yield* feeRefunds; } })),
    intent: vi.fn(async () => ({ currency, latest_charge: { amount: 25100, application_fee: "fee_1" } })),
  };
  const client = {
    refunds: { create: calls.create, list: calls.list, retrieve: calls.retrieve },
    paymentIntents: {
      retrieve: calls.intent,
    },
    applicationFees: {
      retrieve: async () => ({ amount: 500, amount_refunded: returnedFee, currency }),
      createRefund: calls.feeRefund,
      listRefunds: calls.feeList,
    },
  } as unknown as Stripe;
  return { client, calls };
}

export const stripeError = (code: string) => Object.assign(new Error(code), { code });
