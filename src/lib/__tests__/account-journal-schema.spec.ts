import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const journal = schema.slice(schema.indexOf("-- R8-7 / journal PR 1"));
const definition = (name: string): string => journal.split(`create or replace function public.${name}(`)[1].split("$$;")[0];
const backfill = definition("account_journal_backfill_v1");
const drop = readFileSync("supabase/drop.sql", "utf8");

it("stores integer cents, bounded components, currency, provenance and object snapshots", () => {
  for (const column of ["amount_cents", "tip_cents", "service_cents", "debt_delta_cents"]) {
    expect(journal).toContain(`${column} bigint not null`);
  }
  for (const rule of ["currency in ('MXN', 'USD')", "amount_cents >= 0", "tip_cents >= 0", "service_cents >= 0",
    "tip_cents <= amount_cents and service_cents <= amount_cents - tip_cents", "provenance in ('live', 'backfill')",
    "jsonb_typeof(charge_snapshot) = 'object'", "operation_ref text not null check (btrim(operation_ref) <> '')"]) {
    expect(journal).toContain(rule);
  }
});

it("enforces debt signs, including the explicit historical-collection exception", () => {
  for (const rule of [
    "kind = 'opening' and debt_delta_cents = amount_cents and provenance = 'backfill'",
    "kind in ('charge', 'added_tip') and amount_cents > 0 and debt_delta_cents = amount_cents and provenance = 'live'",
    "kind in ('collection', 'credit') and amount_cents > 0 and debt_delta_cents = -amount_cents and provenance = 'live'",
    "kind = 'collection' and amount_cents > 0 and debt_delta_cents = 0 and provenance = 'backfill'",
    "kind in ('return_approved', 'refund_paid', 'historical_observation') and debt_delta_cents = 0",
  ]) expect(journal).toContain(rule);
});

it("requires and deduplicates each kind's independent source event", () => {
  for (const rule of ["kind = 'charge' and order_id is not null", "kind = 'added_tip' and order_id is not null and payment_id is not null",
    "kind = 'collection' and payment_id is not null", "kind in ('credit', 'return_approved', 'historical_observation') and adjustment_id is not null",
    "kind = 'refund_paid' and refund_operation_id is not null"]) expect(journal).toContain(rule);
  for (const index of ["opening", "charge", "tip", "collection", "adjustment", "refund"]) {
    expect(journal).toContain(`create unique index if not exists account_movements_${index}_once`);
  }
  expect(journal).toContain("account_movements(order_id) where kind = 'charge'");
  expect(journal).toContain("kind <> 'added_tip' or (tip_cents = amount_cents and service_cents = 0)");
  expect(journal).toContain("account_movements(payment_id) where kind = 'collection'");
  expect(journal).toContain("account_movements(adjustment_id, kind)");
  expect(journal).toContain("account_movements(refund_operation_id, operation_ref) where kind = 'refund_paid'");
});

it("checks tenant, account, currency and related sources for every supplied reference", () => {
  const check = definition("check_account_movement_source");
  expect(check).toContain("c.id = new.account_id and c.restaurant_id = new.restaurant_id");
  for (const row of ["o", "p", "a", "r"]) {
    expect(check).toContain(`${row}.restaurant_id is distinct from new.restaurant_id`);
    expect(check).toContain(`${row}.currency is distinct from new.currency`);
  }
  for (const row of ["o", "p"]) expect(check).toContain(`${row}.account_id is distinct from new.account_id`);
  expect(check).toContain("new.order_id <> a.order_id");
  expect(check).toContain("new.adjustment_id <> a.id");
  expect(check).toContain("a.kind <> 'account_credit'");
  expect(check).toContain("a.kind <> 'return'");
  expect(journal).toContain("check_account_movement_source before insert on account_movements");
});

it("denies all client access and gives service_role only select/insert", () => {
  expect(journal).toContain("alter table account_movements enable row level security");
  expect(journal).toContain("revoke all on account_movements from public, anon, authenticated, service_role");
  expect(journal.match(/grant [^;]+ on account_movements to [^;]+/g)).toEqual([
    "grant select, insert on account_movements to service_role",
  ]);
  expect(schema).not.toMatch(/create policy[^;]+on (?:public\.)?account_movements/i);
  expect(backfill).toContain("security definer set search_path = public");
  const signature = "public.account_journal_backfill_v1(uuid, timestamptz)";
  expect(journal).toContain(`revoke all on function ${signature} from public, anon, authenticated, service_role`);
  expect(journal).toContain(`grant execute on function ${signature} to service_role`);
});

it("guards update/delete even as owner; only a removed restaurant's cascade is allowed", () => {
  const guard = definition("guard_account_movement");
  expect(guard).toContain("tg_op = 'DELETE' and pg_trigger_depth() > 1");
  expect(guard).toContain("not exists (select 1 from restaurants where id = old.restaurant_id) then return old");
  expect(guard).toContain("raise exception 'an account movement is immutable'");
  expect(guard).not.toContain("return new");
  expect(journal).toContain("guard_account_movement before update or delete on account_movements");
  const table = journal.split("create table if not exists account_movements (")[1].split("\n);")[0];
  expect(table.match(/on delete cascade/g)).toHaveLength(1);
  expect(table).toContain("references restaurants(id) on delete cascade");
  for (const target of ["customer_accounts", "orders", "payments", "order_adjustments", "refund_operations"]) {
    expect(table).toContain(`references ${target}(id) deferrable initially deferred`);
  }
});

it("locks all accounts before all orders, both in id order, and skips started accounts", () => {
  const locks = ["lock_restaurant_money(p_restaurant)",
    "customer_accounts c where c.restaurant_id = p_restaurant order by c.id for update",
    "orders o where o.restaurant_id = p_restaurant and o.account_id is not null order by o.id for update"];
  for (const lock of locks) expect(backfill).toContain(lock);
  const positions = locks.map(lock => backfill.indexOf(lock));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(backfill).toContain("c.journal_started_at is null order by c.id loop");
  expect(backfill).toContain("p_cutoff < transaction_timestamp()");
  expect(backfill).toContain("unstarted account already has journal movements");
  expect(backfill.indexOf("c.journal_started_at is null order by c.id loop")).toBeLessThan(backfill.indexOf("p_cutoff < transaction_timestamp()"));
  expect(backfill.indexOf("set journal_started_at = p_cutoff")).toBeGreaterThan(backfill.lastIndexOf("insert into account_movements"));
});

it("opens current reduced debt and imports evidenced history without inventing original charges", () => {
  expect(backfill).toContain("sum(round(o.total * 100))");
  expect(backfill).toContain("o.paid = false and o.written_off = false and o.status <> 'cancelled'");
  expect(backfill).toContain("'opening', v_debt, v_tip, v_service, v_debt, p_cutoff");
  expect(backfill).toContain("'historical_observation', a.amount_cents");
  expect(backfill).toContain("a.kind = 'account_credit'");
  expect(backfill).toContain("a.previous_tip - a.resulting_tip");
  expect(backfill).toContain("a.previous_service_fee - a.resulting_service_fee");
  expect(backfill).toContain("'adjustment', to_jsonb(a)");
  expect(backfill).toContain("round(p.tip * 100)::bigint, 0");
  expect(backfill).toContain("'payment', to_jsonb(p)");
  expect(backfill).toContain("historical account payment currency unknown");
  expect(backfill).toContain("'original_total', null, 'original_components', null");
  expect(backfill).toContain("'charged_at', o.charged_at");
  expect(backfill).not.toMatch(/coalesce\(o.charged_at|o.created_at|insert into payments|update orders/i);
});

it("ships the dormant function with drop parity and never starts an account on schema application", () => {
  expect(journal).toContain("add column if not exists journal_started_at timestamptz;");
  expect(journal.match(/account_journal_backfill_v1\(/g)).toHaveLength(3); // declaration, revoke, grant
  for (const name of ["guard_account_movement()", "check_account_movement_source()", "account_journal_backfill_v1(uuid, timestamptz)"]) {
    expect(drop).toContain(`drop function if exists public.${name};`);
  }
  expect(drop).toContain("drop table if exists account_movements cascade;");
});
