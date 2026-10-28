import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { checkAllocations } from "../../../scripts/money-allocations.mjs";

const schema = readFileSync("supabase/schema.sql", "utf8");
function definition(name: string): string {
  return [...schema.matchAll(/create or replace function public\.([a-z_0-9]+)\([\s\S]*?\$\$;/g)]
    .find(m => m[1] === name)?.[0] ?? "";
}

describe("the SQL side of the returns contract", () => {
  it("checks reduced paid components against retained coverage without freeing a receipt", async () => {
    const tables: Record<string, object[]> = {
      payment_allocations: [{ id: "a", restaurant_id: "r1", payment_id: "p", order_id: "o", amount: 100, tip: 10 }],
      refund_allocations: [{ allocation_id: "a", operation_id: "return", amount: 30, tip: 0 }],
      refund_operations: [{ id: "return", restaurant_id: "r1", adjustment_id: "adjustment", source: "cash", amount: 30, tip: 0,
        status: "succeeded", completed_at: "2026-10-28T18:00:00Z" }],
      order_adjustments: [{ id: "adjustment", restaurant_id: "r1", order_id: "o", kind: "return" }],
    };
    type Rows = Record<string, unknown>[] & { eq: (key: string, value: unknown) => Rows };
    const query = (rows: Record<string, unknown>[]): Rows =>
      Object.assign([...rows], { eq: (key: string, value: unknown) => query(rows.filter(r => r[key] === value)) });
    const db = { from: (table: string) => ({ select: () => query((tables[table] ?? []) as Record<string, unknown>[]) }) };
    const all = async (build: () => unknown) => ({ data: build(), error: null });
    const bad = vi.fn();
    await checkAllocations(db, all, [{ id: "o", restaurant_id: "r1", paid: true, written_off: false, status: "completed", total: 70, tip: 10 }],
      [{ id: "p", restaurant_id: "r1", amount: 100, tip: 10, allocation_version: 1, allocation_quality: "exact",
        allocation_origin: "live", unallocated_amount: 0, unallocated_tip: 0 }], { ok: vi.fn(), bad });
    expect(bad).not.toHaveBeenCalled();
    // Money already accepts this exact fixture. The old SQL helper computes
    // principal = 70 - 10 - (100 - 10) = -30 and rejects the same valid return.
    expect(definition("check_paid_coverage")).toContain("retained_order_component_capacity_v1");
    expect(definition("order_component_capacity")).toContain("order_adjustments");
  });

  it("permits multiple immutable returns while retaining a single cancellation", () => {
    expect(schema).toMatch(/drop constraint if exists order_adjustments_order_id_kind_key/);
    expect(schema).toMatch(/create unique index[\s\S]*?on (?:public\.)?order_adjustments\s*\(order_id\)[\s\S]*?where kind = 'cancel'/);
    expect(definition("return_on_order_v1")).toContain("lock_restaurant_money(p_restaurant)");
    expect(definition("return_on_order_v1")).toContain("p_expected_service_cents");
    expect(definition("check_order_return_adjustment_v1")).toContain("refund_allocations");
  });

  it("only permits the exact order transition named by the new adjustment", () => {
    const guard = definition("guard_allocated_order");
    expect(guard).toContain("tabletap.return_adjustment");
    expect(guard).toContain("resulting_service_fee");
    expect(guard).toContain("previous_service_fee");
    // A blanket refund_writer flag must never authorize arbitrary reductions.
    expect(definition("return_on_order_v1")).toContain("set_config('tabletap.return_adjustment'");
  });
});
