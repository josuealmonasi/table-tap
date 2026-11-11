import { vi } from "vitest";
import type Stripe from "stripe";
import { returnFixture } from "@/lib/__tests__/returns-contract-fixtures";
import type { DisputeDb } from "../types";

export const tx = (over: Record<string, unknown> = {}) => ({ id: "txn_debit", source: "dp", amount: -10000, fee: 1500, net: -11500,
  currency: "mxn", type: "adjustment", created: 1794355200, fee_details: [{ amount: over.fee ?? 1500, type: "stripe_fee", currency: "mxn", description: "Dispute fee" }], ...over });
export const providerCase = (over = {}) => ({ id: "dp", object: "dispute", livemode: false, charge: "ch", payment_intent: "pi",
  amount: 10000, currency: "mxn", status: "under_review", reason: "fraudulent", created: 1794355200,
  evidence_details: { due_by: 1795000000 }, balance_transactions: [tx()], ...over });
export const notification = (type = "charge.dispute.created", id = "evt") => ({ id, type, account: "acct_old",
  created: 1794355200, livemode: false, data: { object: providerCase({ status: "needs_response" }) } }) as Stripe.Event;

/** Scripted persistence boundary, not a PostgreSQL implementation/probe. */
export function fixture() {
  const f = returnFixture();
  f.tables.diner_checkouts = [{ id: "checkout", restaurant_id: "original", stripe_payment_intent: "pi",
    stripe_account_id: "acct_old", livemode: false, order_ids: ["order1"], stripe_session_id: "cs" }];
  f.tables.restaurants = [{ id: "original", stripe_account_id: "acct_new" }];
  const events = new Map<string, Record<string, unknown>>();
  const movements = new Map<string, unknown>();
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "enqueue_stripe_dispute_event") {
      if (!events.has(String(args.p_event))) events.set(String(args.p_event), { id: args.p_event, stripe_event_id: args.p_event,
        stripe_dispute_id: args.p_dispute, stripe_account_id: args.p_account, livemode: args.p_live, state: "pending", claim_token: "token" });
      return { data: args.p_event, error: null };
    }
    const event = events.get(String(args.p_event));
    if (name === "claim_stripe_dispute_event") return { data: event?.state === "done" ? null : event, error: null };
    if (name === "fail_stripe_dispute_event") { if (event) event.state = "error"; return { data: null, error: null }; }
    if (name === "finish_stripe_dispute_event") {
      for (const movement of args.p_movements as { stripe_balance_transaction_id: string }[]) movements.set(movement.stripe_balance_transaction_id, movement);
      if (event) event.state = "done";
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const client = { disputes: { retrieve: vi.fn().mockResolvedValue(providerCase()) },
    charges: { retrieve: vi.fn() }, balanceTransactions: { retrieve: vi.fn().mockResolvedValue(tx()),
      list: vi.fn().mockResolvedValue({ data: [], has_more: false }) } };
  return { ...f, rpc, events, movements, client, db: { from: f.from, rpc } as unknown as DisputeDb,
    stripe: client as unknown as Stripe };
}
