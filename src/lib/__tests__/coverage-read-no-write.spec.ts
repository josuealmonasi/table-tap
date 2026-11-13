import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A bill coverage read must not write when allocations are complete. The read
// skips the backfill when payment_allocations_need_backfill says false, so
// that check has to agree with every condition the backfill acts on.
const schema = readFileSync("supabase/schema.sql", "utf8");
function definition(name: string): string {
  const start = schema.lastIndexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf("$$;", start));
}
const squash = (text: string): string => text.replace(/\s+/g, " ");
const coverage = squash(definition("order_coverage"));
const need = squash(definition("payment_allocations_need_backfill"));
const backfill = squash(definition("backfill_payment_allocations"));
const importer = squash(definition("import_historical_return"));
const receiptRule = "(allocation_version = 0 or (allocation_quality = 'unresolved' and allocation_origin = 'legacy' and allocation_reason = 'Overlap receipt needs manager evidence'))";
const writes = /\b(insert into|update \w+ set|delete from|for update|lock_restaurant_money|set_config|perform)\b/i;

describe("order_coverage reads without writing when nothing needs a backfill", () => {
  it("runs the backfill only behind the need check", () => {
    expect(coverage).toContain("if public.payment_allocations_need_backfill(p_restaurant) then perform public.backfill_payment_allocations(p_restaurant); end if;");
    expect(coverage.split("backfill_payment_allocations").length).toBe(2);
    const rest = coverage.replace("perform public.backfill_payment_allocations(p_restaurant);", "");
    expect(rest).not.toMatch(writes);
  });

  it("checks with a read-only function", () => {
    expect(need).toContain("returns boolean language sql stable security definer");
    expect(need.slice(need.indexOf("$$"))).not.toMatch(writes);
    expect(schema).toContain("revoke all on function public.payment_allocations_need_backfill(uuid) from public, anon, authenticated;");
  });

  it("matches the receipts the backfill rewrites, with an index for them", () => {
    expect(backfill.split(receiptRule).length).toBe(3);
    expect(need).toContain(`where restaurant_id = p_restaurant and ${receiptRule}`);
    expect(squash(schema)).toContain(`create index if not exists payments_backfill_pending_idx on payments(restaurant_id) where ${receiptRule.slice(1, -1)};`);
  });

  it("matches every cancelled order the historical import could still change", () => {
    expect(backfill).toContain("rp.allocation_origin = 'legacy' and o.status = 'cancelled'");
    expect(backfill).toContain("perform public.import_historical_return(v_restaurant, v_order)");
    // The importer writes a missing cancel record, a return for an unreturned
    // allocation, or evidence for a return still in historical review.
    expect(importer).toContain("on conflict (order_id) where kind = 'cancel' do nothing");
    expect(importer).toContain("p.allocation_origin = 'legacy' and (r.id is null or (f.historical_review and f.status = 'review'))");
    expect(need).toContain("o.status = 'cancelled' and p.allocation_origin = 'legacy'");
    expect(need).toContain("(r.id is null or (f.historical_review and f.status = 'review') or not exists (select 1 from order_adjustments d where d.order_id = o.id and d.kind = 'cancel'))");
  });

  it("keeps the old signature and coverage body", () => {
    expect(schema).toContain("grant execute on function public.order_coverage(uuid, uuid[]) to service_role;");
    expect(coverage).toContain("'amount', public.retained_order_coverage(p_restaurant, o.id)");
    expect(coverage).toContain("p.allocation_quality = 'unresolved'");
  });
});
