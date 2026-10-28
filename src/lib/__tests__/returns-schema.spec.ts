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

describe("returns audit (Codex, 2026-10-28)", () => {
  it("1: a refund a return counts never also pays a duplicate-charge due", () => {
    const due = definition("record_refund_due_coverage_v1");
    // Every writer of either ledger (verification 1).
    for (const fn of ["record_refund_due_coverage_v1", "finish_refund_due_attempt_v2", "finish_refund_due_attempt"]) {
      expect(definition(fn), fn).toContain("public.refund_owned_by_return_v1(p_restaurant,");
    }
    expect(definition("finish_refund_operation")).toContain("public.refund_id_taken_v1(p_restaurant, p_refund, o.id)");
    expect(due).toContain("p_refunds := '[]'::jsonb;"); // no new due coverage while an attempt is in flight
    expect(definition("refund_id_taken_v1")).toContain("from refund_due_coverage");
  });
  it("2: no manual attribution while an app refund is unresolved", () => {
    const record = definition("record_order_return_coverage_v1");
    expect(record.indexOf("->>'unresolved')::boolean")).toBeLessThan(record.indexOf("insert into refund_attempts"));
    expect(record).toContain("return jsonb_build_object('outcome', 'pending');");
    // Saved evidence replays before the guard, so a retry can finish (verification 3).
    expect(record.indexOf("if x.id is not null then")).toBeLessThan(record.indexOf("->>'unresolved')::boolean"));
  });
  it("4: completion names a refund that still counts, and the fee reconciler finds every one", () => {
    expect(definition("complete_refund_operation_v1")).toContain("stripe_refund_id = coalesce((select a.stripe_refund_id from refund_attempts a");
    expect(definition("finish_refund_operation_v2")).not.toContain("coalesce(stripe_refund_id, r->>'id')");
    // A stale partial snapshot must not match an earlier piece (verification 5).
    expect(definition("apply_verified_platform_fee")).not.toContain("a.stripe_refund_id = any(p_refunds)");
  });
  it("6: an offline replay acknowledges what was collected", () => {
    expect(definition("pos_ticket")).toContain("v_order.total + coalesce((select sum(a.previous_total - a.resulting_total) from order_adjustments a");
  });
  it("8: an unknown tip breakdown sends only the tip share to review", () => {
    const prepare = definition("return_on_order_v1");
    // Food returns on such a receipt plan exactly; only a tip share goes to a person.
    expect(prepare.indexOf("if v_unknown and v_tr > 0 then return jsonb_build_object('outcome', 'review'); end if;"))
      .toBeLessThan(prepare.indexOf("insert into order_adjustments"));
  });
  it("verification 4, 6, 7: no synthetic evidence beside pieces; provider time; one coverage rule", () => {
    expect(definition("start_refund_attempt")).toContain("not exists (select 1 from refund_attempts x where x.operation_id = o.id)");
    expect(definition("refund_success_time_v1")).toContain("least(now(),");
    expect(definition("refund_operation_progress_v1")).toContain("not exists (select 1 from refund_attempts x where x.operation_id = o.id) then 0");
    const events = definition("order_return_events_v1");
    expect(events).toContain("raise exception 'a completed return does not reconcile with its refunds'");
    expect(events).toContain("distinct on (o.id, a.stripe_refund_id)");
  });
  it("verification 2: V1 due id, V5 fee revision on completion, V7 one owner per refund", () => {
    expect(definition("finish_refund_due_attempt_v2")).toContain("v_first := coalesce(v_first, e->>'id');");
    expect(definition("complete_refund_operation_v1")).toContain("perform public.enqueue_fee_reconcile(o.restaurant_id, o.stripe_payment_intent)");
    expect(definition("order_return_events_v1")).toContain("raise exception 'a provider refund is counted by two returns'");
    expect(definition("refund_operation_progress_v1")).toContain("order by a.stripe_refund_id, a.attempt_no, a.id");
    // Verification 3: header owners count; the manual due writer and a pending due keep their own ids.
    expect(definition("order_return_events_v1")).toContain("union select o.stripe_refund_id, o.id from refund_operations o");
    expect(definition("record_refund_due_coverage_v1")).toContain("stripe_refund_id = coalesce(d.stripe_refund_id, v_first)");
    expect(definition("finish_refund_due_attempt_v2")).toContain("v_first := case when p_status <> 'succeeded'");
    expect(definition("order_return_events_v1")).toContain("raise exception 'two records of one refund disagree'");
  });
});
