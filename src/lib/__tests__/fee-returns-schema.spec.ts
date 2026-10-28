import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The SQL half of the fee-return contract (audit S; agreed with Codex in
// tabletap-release/loop/dialogue). Replayed on dev Postgres in MX$ and US$;
// these pin the rules so a later edit cannot quietly drop one.
const sql = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const body = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];

const SERVER_ONLY = [
  "prepare_fee_return(uuid, text, text, text, text, int, int, int)",
  "claim_fee_return(uuid, uuid, int, int)",
  "record_fee_return(uuid, uuid, text)",
  "enqueue_fee_reconcile(uuid, text)",
  "ack_fee_reconcile(uuid, text, int)",
  "finish_refund_due_attempt_v2(uuid, uuid, uuid, text, jsonb, text)",
];

it("every new function runs under the money lock and is callable by the server only", () => {
  for (const fn of SERVER_ONLY) {
    const name = fn.split("(")[0];
    expect(body(name), name).toContain("perform public.lock_restaurant_money(p_restaurant);");
    expect(sql, name).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
    expect(sql, name).toContain(`grant execute on function public.${fn} to service_role;`);
    expect(drop, name).toContain(`drop function if exists public.${fn};`);
  }
  expect(sql).toContain("revoke all on function public.bump_fee_revision(uuid, text) from public, anon, authenticated;");
  expect(sql).not.toMatch(/grant execute on function public\.bump_fee_revision/);
});

it("prepare and claim refuse a revision read before the last transition, and hand on the new one", () => {
  for (const name of ["prepare_fee_return", "claim_fee_return"]) {
    expect(body(name), name).toMatch(/if p_revision is null or p_revision <> public\.refund_fee_epoch\(/);
    expect(body(name), name).toContain("'revision', public.bump_fee_revision(");
  }
});

it("absence never authorises a replacement: only the same row and key are resent, and past 23 hours it is unresolved", () => {
  const claim = body("claim_fee_return");
  expect(claim).toContain("r.created_at < now() - interval '23 hours'");
  expect(claim).toContain("status = 'unresolved'");
  expect(claim).toContain("r.claimed_at < now() - interval '1 hour'");
  expect(claim).toContain("'outcome', 'reclaimed'");
  // Only a request never sent may be retired for a smaller remainder.
  expect(body("prepare_fee_return")).toContain("if r.status <> 'prepared' or r.amount_cents <= v_remainder then");
  expect(sql).toContain("create unique index if not exists fee_returns_one_open on fee_returns (restaurant_id, stripe_payment_intent)\n  where status in ('prepared', 'dispatched', 'unresolved');");
});

it("positive evidence settles an unresolved request; identity and success are immutable", () => {
  expect(body("record_fee_return")).toContain("if r.status not in ('dispatched', 'unresolved') then");
  const guard = body("guard_fee_return");
  expect(guard).toContain("raise exception 'fee return identity is immutable'");
  expect(guard).toContain("raise exception 'a returned fee stays returned'");
});

it("the queue acks only the generation it reconciled", () => {
  expect(body("ack_fee_reconcile")).toContain("and generation = p_generation;");
});

it("coverage completes a duplicate-charge refund only when active refunds pay it all, and a failure reopens it", () => {
  const finish = body("finish_refund_due_attempt_v2");
  expect(finish).toContain("on conflict (due_id, stripe_refund_id) do update set active = refund_due_coverage.active and excluded.active");
  expect(finish).toContain("if v_covered >= v_due then");
  expect(finish).toContain("'outcome', 'partial'");
  expect(body("start_refund_due_attempt")).toContain("(a.provider_status = 'succeeded' and v_covered < v_due)");
  const reverse = body("reverse_failed_refund_v2");
  expect(reverse).toContain("update refund_due_coverage set active = false");
  expect(reverse).toContain("update fee_returns set status = 'superseded'");
});

it("deletion waits for every open fee return and queued charge", () => {
  const del = body("admin_delete_restaurant");
  expect(del).toContain("from fee_returns where restaurant_id = p_restaurant and status in ('prepared', 'dispatched', 'unresolved')");
  expect(del).toContain("from fee_reconcile_queue where restaurant_id = p_restaurant");
});
