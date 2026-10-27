import { vi } from "vitest";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";

export interface Request {
  id: string; restaurant_id: string; stripe_payment_intent: string; stripe_account_id: string;
  stripe_fee_id: string; currency: string; attempt_no: number; amount_cents: number;
  idempotency_key: string; status: string; created_at: number; claimed_at: number;
}

/** In-memory transitions follow the agreed RPC contract, not the legacy SQL. */
export function chargeFixture(currency: string) {
  let revision = 0;
  let generation: number | null = 0;
  let returned = 0;
  let serial = 0;
  let now = Date.now();
  const row = { fee_verification_pending: false, fee_target_cents: null as number | null, fee_reconciled_at: null as string | null };
  const read = vi.fn(async () => ({ data: { ...row } as object | null, error: null as { message: string } | null }));
  const requests: Request[] = [];
  const refunds = [{ id: "re_60", status: "succeeded", amount: 6000 }];
  const evidence: { id: string; amount: number; currency: string; metadata: Record<string, string> }[] = [];
  const providerKeys = new Map<string, typeof evidence[number]>();
  const calls: string[] = [];
  const rpc = vi.fn(async (name: string, a: Record<string, unknown>) => {
    calls.push(name);
    if (name === "refund_fee_epoch") return { data: revision, error: null };
    if (name === "enqueue_fee_reconcile") { generation = ++revision; return { data: generation, error: null }; }
    if (name === "ack_fee_reconcile") {
      const same = generation === a.p_generation;
      if (same) generation = null;
      return { data: same, error: null };
    }
    if (name === "verify_refunded_platform_fee_v2") {
      if (a.p_epoch !== revision) return { data: false, error: null };
      row.fee_target_cents = Number(a.p_target);
      row.fee_verification_pending = Number(a.p_cents) < Number(a.p_target);
      row.fee_reconciled_at = row.fee_verification_pending ? null : "2026-10-27T12:00:00Z";
      return { data: true, error: null };
    }
    if (name === "prepare_fee_return") {
      if (a.p_revision !== revision) return { data: { outcome: "stale" }, error: null };
      const remainder = Number(a.p_target) - Number(a.p_returned);
      let open = requests.find(r => ["prepared", "dispatched", "unresolved"].includes(r.status));
      if (open?.status === "prepared" && open.amount_cents > remainder) { open.status = "superseded"; revision++; open = undefined; }
      if (open) return { data: { outcome: "open", request: { ...open }, revision }, error: null };
      if (remainder <= 0) return { data: { outcome: "none", revision }, error: null };
      const request = seed("prepared", remainder);
      revision++;
      return { data: { outcome: "prepared", request: { ...request }, revision }, error: null };
    }
    const requestRow = requests.find(r => r.id === a.p_id);
    if (!requestRow) throw Error(`No request for ${name}`);
    if (name === "claim_fee_return") {
      if (a.p_revision !== revision) return { data: { outcome: "stale" }, error: null };
      let outcome = "wait";
      if (requestRow.status === "prepared") { requestRow.status = "dispatched"; outcome = "claimed"; }
      else if (requestRow.status === "dispatched" && now - requestRow.created_at >= 23 * 3600000) { requestRow.status = "unresolved"; outcome = "unresolved"; }
      else if (requestRow.status === "dispatched" && now - requestRow.claimed_at > 3600000 && requestRow.amount_cents <= Number(a.p_remainder)) outcome = "reclaimed";
      if (outcome !== "wait") { requestRow.claimed_at = now; revision++; }
      return { data: { outcome, request: { ...requestRow }, revision }, error: null };
    }
    if (name === "record_fee_return") { requestRow.status = "succeeded"; return { data: { revision: ++revision }, error: null }; }
    throw Error(`Unexpected RPC ${name}`);
  });
  function seed(status: string, amount = 180) {
    const n = ++serial;
    const request = { id: `request-${n}`, restaurant_id: "r", stripe_payment_intent: "pi", stripe_account_id: "acct",
      stripe_fee_id: "fee", currency: currency.toUpperCase(), attempt_no: n, amount_cents: amount,
      idempotency_key: `fee-key-${n}`, status, created_at: now, claimed_at: now };
    requests.push(request);
    return request;
  }
  const from = vi.fn((table: string) => {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, is: () => q, not: () => q,
      update: (patch: object) => { Object.assign(row, patch); return q; },
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
      maybeSingle: async () => table === "refunds_due" ? read() : ({ data: ["restaurants", "diner_checkouts"].includes(table) ? { id: "r", stripe_account_id: "acct" }
        : table === "fee_returns" ? requests.at(-1) ?? null : generation === null ? null : { generation }, error: null }),
      range: async (start: number) => ({ data: start > 0 ? [] : table === "fee_reconcile_queue" && generation !== null
        ? [{ stripe_payment_intent: "pi", generation }] : [], error: null }) };
    return q;
  });
  const createRefund = vi.fn(async (_fee: string, params: { amount: number; metadata: Record<string, string> }, options: { idempotencyKey: string }) => {
    const old = providerKeys.get(options.idempotencyKey);
    if (old) return old;
    const made = { id: `fr_${evidence.length}`, amount: params.amount, currency, metadata: params.metadata };
    returned += params.amount; evidence.push(made); providerKeys.set(options.idempotencyKey, made); return made;
  });
  const feePages = vi.fn(() => (async function* () { for (const item of evidence) { calls.push("fee-page"); yield item; } calls.push("fee-end"); })());
  const client = { paymentIntents: { retrieve: vi.fn(async () => { calls.push("stripe"); return {
    currency, latest_charge: { id: "ch", amount: 10000, currency, application_fee: "fee" } }; }) },
    refunds: { list: () => (async function* () { yield* refunds; })() },
    applicationFees: { retrieve: vi.fn(async () => ({ id: "fee", amount: 300, amount_refunded: returned, currency })),
      listRefunds: feePages, createRefund } } as unknown as Stripe;
  return { db: { rpc, from } as unknown as ReturnType<typeof createAdminClient>, client, rpc, calls, requests, refunds, evidence,
    createRefund, feePages, seed, row, read, get generation() { return generation; }, get returned() { return returned; },
    set returned(value: number) { returned = value; }, age(hours: number) { now += hours * 3600000; } };
}
