import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const sql = () => readFileSync("supabase/schema.sql", "utf8");
it.each(["stripe_disputes", "stripe_dispute_movements", "stripe_dispute_events"])("%s is RLS-enabled and service-only, and archived before deletion", table => {
  expect(sql()).toContain(`alter table ${table} enable row level security;`);
  expect(sql()).toMatch(/revoke all on stripe_disputes, stripe_dispute_movements, stripe_dispute_events from public, anon, authenticated/);
  const archive = sql().slice(sql().indexOf("foreach v_table in array array["));
  expect(archive.split("] loop")[0]).toContain(`'${table}'`);
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain(`drop table if exists ${table} cascade;`);
});
it("tenant and provider scope must agree on every linked financial row", () => {
  for (const columns of ["restaurant_id, order_id", "restaurant_id, diner_checkout_id", "restaurant_id, account_checkout_id",
    "restaurant_id, dispute_id, livemode, stripe_account_id", "restaurant_id, first_event_id, livemode, stripe_account_id"])
    expect(sql()).toContain(`foreign key (${columns})`);
  for (const id of ["stripe_dispute_id", "stripe_event_id", "stripe_balance_transaction_id"]) expect(sql()).toContain(`unique (livemode, stripe_account_id, ${id})`);
});
it("money is inserted idempotently, checked against immutable evidence and never overwritten", () => {
  expect(sql()).toContain("check (amount_minor - fee_minor = net_minor)");
  expect(sql()).toContain("on conflict (livemode, stripe_account_id, stripe_balance_transaction_id) do nothing");
  for (const value of ["amount_minor", "fee_minor", "net_minor", "currency", "fee_details", "provider_created_at", "provider_type"])
    expect(sql()).toMatch(new RegExp(`t\\.${value} = \\(m->>|t\\.${value} = m->`));
  expect(sql()).toContain("raise exception 'Conflicting immutable dispute transaction'");
  expect(sql()).toContain("raise exception 'Provider omitted recorded dispute evidence'");
});
it("serializes case workers and fences an expired or superseded claim before writing", () => {
  const disputes = sql().slice(sql().indexOf("create or replace function public.claim_stripe_dispute_event"),
    sql().indexOf("create or replace function public.fail_stripe_dispute_event"));
  expect(disputes.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
  expect(sql()).toContain("claim_token = gen_random_uuid(), lease_until = now() + interval '2 minutes'");
  expect(sql()).toContain("e.claim_token is distinct from p_claim or e.state <> 'processing' or e.lease_until <= now()");
  const finish = sql().slice(sql().indexOf("create or replace function public.finish_stripe_dispute_event"));
  expect(finish.indexOf("e.claim_token is distinct")).toBeLessThan(finish.indexOf("insert into stripe_disputes"));
});
it("unmatched or won-but-uncredited cases stay pending and block restaurant deletion", () => {
  expect(sql()).toContain("when v_restaurant is null or not (p_case->>'matched')::boolean then 'review'");
  expect(sql()).toContain("p_case->>'status' = 'won' and v_waiting");
  expect(sql()).toContain("state = case when v_state = 'reconciled' then 'done' else 'pending' end");
  expect(sql()).toContain("reconciliation_state <> 'reconciled' or status not in ('won', 'lost', 'warning_closed', 'prevented')");
  expect(sql()).toContain("return jsonb_build_object('outcome', 'dispute')");
});
it("inbox discovery can attribute the original tenant before an unavailable provider read", () => {
  const enqueue = sql().slice(sql().indexOf("create or replace function public.enqueue_stripe_dispute_event"), sql().indexOf("create or replace function public.claim_stripe_dispute_event"));
  expect(enqueue).toContain("from diner_checkouts where stripe_account_id = p_account and livemode = p_live and stripe_payment_intent = p_intent");
  expect(enqueue).toContain("from payments where stripe_account_id = p_account and stripe_payment_intent = p_intent");
  expect(enqueue).toContain("if v_tenants = 0 then");
});
it("the proposed RPC argument names fit all four new callers without weakening the deployed-schema gate", () => {
  const sources = ["ingest", "reconcile"].map(name => readFileSync(`src/lib/disputes/${name}.ts`, "utf8")).join("\n");
  const expected: Record<string, string[]> = { enqueue_stripe_dispute_event: ["p_account", "p_live", "p_event", "p_dispute", "p_intent", "p_type", "p_created"],
    claim_stripe_dispute_event: ["p_event"], finish_stripe_dispute_event: ["p_event", "p_claim", "p_case", "p_movements"], fail_stripe_dispute_event: ["p_event", "p_claim", "p_error"] };
  for (const [name, names] of Object.entries(expected)) {
    expect(sources).toContain(`rpc("${name}"`);
    const signature = new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`).exec(sql())?.[1];
    expect(signature?.split(",").map(arg => arg.trim().split(/\s+/)[0])).toEqual(names);
    expect(sql()).toContain(`revoke all on function public.${name}(`);
  }
});
it("dispute recording never writes a fee refund, sale, payment, allocation or drawer entry", () => {
  const sources = ["ingest", "reconcile"].map(name => readFileSync(`src/lib/disputes/${name}.ts`, "utf8")).join("\n");
  expect(sources).not.toMatch(/applicationFees|createRefund|refund_platform_fee|logMoney|from\("(?:orders|payments|payment_allocations|user_logs)"\)\.(?:insert|update|upsert|delete)/);
});
