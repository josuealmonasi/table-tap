import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
function definition(name: string): string {
  return [...schema.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "g"))].at(-1)?.[0] ?? "";
}
const snapshot = definition("snapshot_payment_scope");
const backfill = definition("backfill_payment_allocations");
const finish = definition("finish_payment_allocation");

describe("seed receipts and historical backfill agree", () => {
  it("writes the current version before a coverage read can request repair", () => {
    const history = snapshot.match(/if current_setting\('tabletap.allocation_origin', true\) = 'fixture_history'[\s\S]*?end if;/)?.[0] ?? "";
    expect(history).toContain("new.order_id is not null");
    expect(history).toContain("restaurant_id = new.restaurant_id");
    expect(history).toContain("new.allocation_version := 1;");
    expect(history).toContain("new.allocation_origin := 'legacy';");
    expect(history).toContain("return new;");
    expect(snapshot.indexOf(history)).toBeLessThan(snapshot.indexOf("new.allocation_version := 0;"));
  });

  it("matches every explicit-order backfill field, including missing tip evidence", () => {
    // Compare the actual SQL expressions, not a second hand-written allocator.
    // A changed field on either path must change this contract deliberately.
    const update = backfill.match(/update payments set allocation_version = 1, allocation_quality = 'exact', allocation_scope[\s\S]*?where id = p.id;/)?.[0] ?? "";
    const assignments = [...update.matchAll(/(\w+) = ([\s\S]*?)(?=,\s*\w+ = | where id = p.id;)/g)];
    expect(assignments.map(m => m[1])).toEqual(["allocation_version", "allocation_quality", "allocation_scope",
      "unallocated_amount", "unallocated_tip", "currency", "breakdown_unknown", "allocation_reason"]);
    for (const [, field, expression] of assignments) {
      expect(snapshot.replace(/\s+/g, " ")).toContain(`new.${field} := ${expression.replaceAll("p.order_id", "new.order_id").replaceAll("p.tip", "new.tip").replace(/\s+/g, " ")};`);
    }
    // Missing old tip metadata stays missing. Inferring the order's tip here
    // would change the historical drawer and the return review's evidence.
    const allocation = /insert into payment_allocations\(restaurant_id, payment_id, order_id, amount, tip, provenance\)\s+values\(([^;]+)\);/;
    const oldValues = backfill.match(allocation)?.[1];
    expect(oldValues).toBeDefined();
    expect(finish.match(allocation)?.[1]).toBe(oldValues?.replaceAll("p.", "new."));
    expect(finish).toContain("new.allocation_version = 1");
    expect(finish).toContain("new.allocation_origin = 'legacy'");
    expect(finish).toContain("else\n    perform public.allocate_receipt(new.id);");
  });

  it("opts in only the synthetic history; current product writers keep their allocator", () => {
    const seed = readFileSync("scripts/mock-data.mjs", "utf8");
    expect(seed.indexOf("'fixture_history'")).toBeLessThan(seed.indexOf('"payments"'));
    expect(seed).toContain("select set_config('tabletap.allocation_origin', '', false)");
    expect(snapshot).toContain("current_setting('tabletap.allocation_writer', true) is distinct from 'v1'");
    expect(schema).toContain("revoke all on function public.snapshot_payment_scope() from public, anon, authenticated;");
    expect(schema).toContain("grant execute on function public.snapshot_payment_scope() to service_role;");
  });
});
