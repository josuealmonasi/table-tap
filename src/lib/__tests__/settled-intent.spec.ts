import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// Codex bl43 findings 4 and 5: Stripe delivers events in any order. A refund
// or a dispute that arrived before the checkout owning its PaymentIntent
// settled found no sale, so the fee return was never queued and the dispute
// was left out of the restaurant's books. Settlement now adopts both.
const state = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  writes: [] as string[],
  checkoutIntent: null as string | null,
  rpcError: null as { message: string } | null,
}));
const record = { stripe_session_id: "cs_1", restaurant_id: "r1", stripe_account_id: "acct_1", livemode: false,
  currency: "MXN", amount_cents: 40000, metadata: { order_id: "o1", restaurant_id: "r1" }, order_ids: ["o1"] };
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/diner-checkout-orders", () => ({
  dinerCheckoutOrders: async () => [{ id: "o1", restaurant_id: "r1", currency: "MXN" }],
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    state.calls.push({ fn, args });
    return { data: null, error: state.rpcError };
  },
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let byIntent: string | null = null;
    for (const method of ["select", "not", "order", "limit"]) q[method] = () => q;
    q.eq = (column: string, value: string) => { if (column === "stripe_payment_intent") byIntent = value; return q; };
    q.update = (patch: { stripe_payment_intent?: string }) => {
      state.writes.push(table);
      state.checkoutIntent = patch.stripe_payment_intent ?? state.checkoutIntent;
      return q;
    };
    const answer = () => ({ error: null, data: table === "restaurants" ? { id: "r1", stripe_account_id: "acct_1" }
      // Before settlement binds it, no checkout row carries the intent.
      : table === "diner_checkouts" && (!byIntent || byIntent === state.checkoutIntent)
        ? { ...record, stripe_payment_intent: state.checkoutIntent } : null });
    q.single = q.maybeSingle = async () => answer();
    q.then = (resolve: (r: unknown) => void) => Promise.resolve(answer()).then(resolve);
    return q;
  },
}) }));

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_settled");
  state.calls.length = 0; state.writes.length = 0; state.checkoutIntent = null; state.rpcError = null;
});

const session = (paid: boolean) => ({ id: "cs_1", mode: "payment", livemode: false, amount_total: 40000, currency: "mxn",
  payment_status: paid ? "paid" : "unpaid", payment_intent: "pi_1", metadata: record.metadata }) as unknown as Stripe.Checkout.Session;

it("keeps a refund that beat its checkout, and settlement adopts the same account, mode and intent", async () => {
  const { enqueueRefundFee } = await import("@/lib/refunds/fee-queue");
  const { verifyDinerCheckout } = await import("@/lib/diner-checkout");
  // The refund arrives first: no record links the intent yet.
  await enqueueRefundFee({ payment_intent: "pi_1" } as Stripe.Refund, "acct_1", false);
  expect(state.calls).toEqual([{ fn: "note_unmatched_refund_v1",
    args: { p_restaurant: "r1", p_account: "acct_1", p_live: false, p_intent: "pi_1" } }]);
  // Then checkout completes. The hook runs only after the intent is bound.
  await verifyDinerCheckout(session(true), { account: "acct_1", livemode: false });
  expect(state.writes).toEqual(["diner_checkouts"]);
  expect(state.calls[1]).toEqual({ fn: "adopt_settled_intent_v1",
    args: { p_restaurant: "r1", p_account: "acct_1", p_live: false, p_intent: "pi_1" } });
});

it("adopts nothing for an unpaid session, and a failed adoption fails the webhook so Stripe retries", async () => {
  const { verifyDinerCheckout } = await import("@/lib/diner-checkout");
  await verifyDinerCheckout(session(false), { account: "acct_1", livemode: false });
  expect(state.calls).toEqual([]);
  state.rpcError = { message: "offline" };
  await expect(verifyDinerCheckout(session(true), { account: "acct_1", livemode: false })).rejects.toThrow(/early events/);
});

it("SQL: settlement queues the kept refund's fee and requeues only review disputes on the same intent", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const drop = readFileSync("supabase/drop.sql", "utf8");
  const adopt = sql.slice(sql.indexOf("create or replace function public.adopt_settled_intent_v1("));
  const body = adopt.slice(0, adopt.indexOf("\n$$;"));
  // Only a checkout of this restaurant that already holds the intent can adopt.
  expect(body).toMatch(/from diner_checkouts where restaurant_id = p_restaurant and stripe_account_id = p_account\s+and livemode = p_live and stripe_payment_intent = p_intent/);
  expect(body).toMatch(/delete from unmatched_refund_notices[\s\S]*if found then\s+perform public\.enqueue_fee_reconcile\(p_restaurant, p_intent\)/);
  expect(body).toMatch(/s\.stripe_account_id = p_account and s\.livemode = p_live and s\.stripe_payment_intent = p_intent\s+and s\.reconciliation_state = 'review'/);
  expect(body).toContain("and e.state = 'done'");
  for (const table of ["unmatched_refund_notices", "refund_due_reviews"]) {
    expect(sql).toContain(`alter table ${table} enable row level security;`);
    expect(sql).not.toMatch(new RegExp(`create policy [^;]* on (public\\.)?${table}\\b`));
    expect(drop).toContain(`drop table if exists ${table} cascade;`);
  }
  for (const fn of ["adopt_settled_intent_v1(uuid, text, boolean, text)", "note_unmatched_refund_v1(uuid, text, boolean, text)",
    "reconcile_refund_due_send_v1(uuid, uuid, uuid, text, jsonb, int, text[])", "start_refund_due_attempt_v3(uuid, uuid, int, text[])"]) {
    expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    expect(drop).toContain(`drop function if exists public.${fn};`);
  }
  // Deployed code still calls v2; its signature stays.
  expect(sql).toContain("create or replace function public.start_refund_due_attempt_v2(p_restaurant uuid, p_due uuid, p_refundable_cents int)");
});
