import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
function definition(name: string): string {
  return [...schema.matchAll(/create or replace function public\.([a-z_0-9]+)\([\s\S]*?\$\$;/g)]
    .find(m => m[1] === name)?.[0] ?? "";
}
const batch = definition("collect_on_sittings_v1");

describe("a collection shares the existing money transaction rules", () => {
  it("takes the restaurant lock, allocation backfill and ordered sitting locks before collecting", () => {
    const steps = ["public.lock_restaurant_money(p_restaurant)", "public.backfill_payment_allocations(p_restaurant)",
      "pg_advisory_xact_lock", "v_outcome := public.collect_on_sitting_v2("];
    for (let n = 1; n < steps.length; n++) expect(batch.indexOf(steps[n - 1])).toBeLessThan(batch.indexOf(steps[n]));
    expect(batch).toContain("order by 1 loop");
    expect(batch).toContain("set_config('tabletap.allocation_writer', 'v1', true)");
    expect(batch).not.toMatch(/exception\s+when/i);
  });

  it("is restricted to the service role and checks every sitting's tenant", () => {
    expect(batch).toContain("security definer\nset search_path = public");
    expect(batch).toContain("t.restaurant_id = p_restaurant");
    const signature = "public.collect_on_sittings_v1(uuid, jsonb, text, text, text, numeric)";
    expect(schema).toContain(`revoke all on function ${signature}\n  from public, anon, authenticated`);
    expect(schema).toContain(`grant execute on function ${signature}\n  to service_role`);
    expect(readFileSync("supabase/drop.sql", "utf8")).toContain(`drop function if exists ${signature}`);
  });

  it("keeps sitting references stable, recognizes old receipts and subtracts recorded money and tip", () => {
    expect(batch).toContain("p_ref || '#' || v_session::text");
    expect(batch).toContain("jsonb_array_length(p_shares) = 1 and v_seen = 0 then p_ref");
    expect(batch).toContain("client_ref = p_ref or left(client_ref, length(p_ref) + 1) = p_ref || '#'");
    expect(batch).toContain("p_total - v_seen");
    expect(batch).toContain("case when v_seen > 0 then 0");
  });

  it("keeps bill, own checkout, split and account writers on the same lock and coverage rules", () => {
    for (const name of ["collect_on_sitting_v2", "settle_orders_v2", "settle_card_orders_v2",
      "settle_split_share_v2", "account_charge_v2", "account_settle_v2"]) {
      expect(definition(name), name).toContain("public.lock_restaurant_money(");
    }
    const sitting = definition("collect_on_sitting_v2");
    expect(sitting).toContain("public.retained_order_coverage(p_restaurant, id)");
    expect(sitting).toContain("account_id is null");
    expect(sitting).toContain("v_take := least(");
    expect(sitting).toContain("update bill_splits set status = 'cancelled'");
    expect(definition("settle_card_orders_v2")).toContain("public.retained_order_coverage(");
    expect(definition("settle_split_share_v2")).toContain("p_amount > v_remaining");
    expect(definition("account_charge_v2")).toContain("'partly_paid'");
    expect(definition("close_divided_bill_v2")).toContain("public.retained_order_coverage(");
  });
});
