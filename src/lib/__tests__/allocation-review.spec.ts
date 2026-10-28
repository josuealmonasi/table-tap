import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import legacyWriters from "./fixtures/legacy-payment-writers.json";

const schema = readFileSync("supabase/schema.sql", "utf8");
// Fingerprints pin the deployed d7a0729 writers without needing Git history in CI.
function definition(source: string, name: string): string {
  return [...source.matchAll(/create or replace function public\.([a-z_0-9]+)\([\s\S]*?\$\$;/g)]
    .find(m => m[1] === name)?.[0] ?? "";
}
const writers = Object.keys(legacyWriters) as (keyof typeof legacyWriters)[];

describe("PR1 schema review regressions", () => {
  it("preserves deployed money writes, apart from overlap locks and unproven stock returns", () => {
    for (const name of writers) {
      const normalize = (s: string) => s.replace(/  perform public\.lock_restaurant_money\([^\n]+\);\n/g, "")
        // S13 changes only the unproven stock credit; pin every money line as before.
        .replace("  -- The order trigger returns proven reservations and logs unknown legacy stock.",
          "  if not v_order.stock_managed and v_order.stock_reservation_id is null then\n" +
          "    perform release_stock(p_restaurant, p_legacy_demand);\n  end if;");
      expect(createHash("sha256").update(normalize(definition(schema, name))).digest("hex"), name).toBe(legacyWriters[name]);
    }
  });
  it("recovers queued receipts through allocation writers and guards every POS insert", () => {
    const recovery = definition(schema, "record_offline_sale");
    expect(recovery).toContain("v_ticket := public.ring_pos_sale_v2(p_restaurant");
    expect(recovery).not.toContain("public.ring_pos_sale(");
    expect(recovery).toContain("set_config('tabletap.offline_queue_writer', p_ref::text, true)");
    const insert = definition(schema, "pos_insert_order");
    expect(insert).toContain("from offline_sale_queue where pos_ref = p_ref");
    expect(insert).toContain("current_setting('tabletap.offline_queue_writer',true) is distinct from p_ref::text");
    expect(insert.indexOf("manager approval required")).toBeLessThan(insert.indexOf("insert into orders"));
    for (const name of ["ring_pos_sale", "ring_pos_sale_v2", "ring_pos_account", "ring_pos_account_v2"]) {
      expect(definition(schema, name), name).toContain("public.pos_insert_order(");
      expect(definition(schema, name), name).toContain("public.lock_restaurant_money(p_restaurant)");
    }
  });
  it("guards every order writer, and gates only the paid-coverage check on versioned writers", () => {
    // Opt-in let three direct writers past it (paths audit #2, #4, #5).
    const guard = definition(schema, "guard_allocated_order");
    expect(guard).not.toContain("current_setting('tabletap.allocation_writer', true) is distinct from 'v1' then return new");
    expect(guard).toContain("new.total is not distinct from old.total and new.tip is not distinct from old.tip");
    expect(definition(schema, "check_paid_coverage")).toContain("current_setting('tabletap.allocation_writer', true) is distinct from 'v1' then");
    expect(definition(schema, "snapshot_payment_scope")).toContain("new.allocation_version := 0");
    expect(definition(schema, "collect_on_sitting_v2")).toContain("backfill_payment_allocations");
  });
  it("locks and numbers duplicate-payment refund attempts and rejects stale outcomes", () => {
    expect(definition(schema, "start_refund_due_attempt")).toContain("lock_restaurant_money(p_restaurant)");
    expect(definition(schema, "start_refund_due_attempt")).toContain("a.provider_status in ('failed', 'canceled')");
    expect(definition(schema, "finish_refund_due_attempt")).toContain("p_attempt is distinct from");
  });
  it("includes existing unpaid tip in partial receipt metadata", () => {
    expect(definition(schema, "collect_on_sitting_v2")).toContain("v_existing_tip");
    expect(definition(schema, "collect_on_sitting_v2")).toContain("v_take - coalesce(p_tip, 0)");
    expect(definition(schema, "collect_on_sitting_v2")).toContain("least(v_room, v_existing_tip)");
  });
  it("allows historical cancelled orders and imports uniquely evidenced old handbacks", () => {
    const attribution = definition(schema, "attribute_payment");
    expect(attribution).toContain("p.allocation_origin = 'legacy'");
    expect(attribution).toContain("import_historical_return");
    expect(definition(schema, "import_historical_return")).toContain("historical_log_id");
    expect(readFileSync("src/lib/refunds/adjustments.ts", "utf8")).toContain('is("historical_log_id", null)');
  });
  it("leaves unproven historical currency unknown and checks attribution and returns", () => {
    const backfill = definition(schema, "backfill_payment_allocations");
    expect(backfill).not.toContain("currency from restaurants");
    expect(definition(schema, "attribute_payment")).toContain("o.currency = p_currency");
    expect(definition(schema, "prepare_order_refund")).toContain("x->>'currency' is distinct from o.currency");
  });
  it("checks principal and tip capacity separately, with an explicit historical exception", () => {
    expect(definition(schema, "attribute_payment")).toContain("order_component_capacity");
    expect(definition(schema, "check_paid_coverage")).toContain("order_component_capacity");
    expect(definition(schema, "order_component_capacity")).toContain("breakdown_unknown");
  });
  it("uses house filenames and explains the retired duplicate receipt initializer", () => {
    for (const file of ["src/components/dashboard/OrderRefunds.tsx", "src/components/dashboard/PaymentAttribution.tsx",
      "src/lib/__tests__/allocation-readers.spec.tsx", "src/lib/refunds/__tests__/operations.spec.tsx"]) expect(existsSync(file), file).toBe(true);
    expect(schema).toContain("retired receipt initializer");
    expect(readFileSync("src/lib/i18n/en.ts", "utf8")).not.toMatch(/Historical receipt attribution|Cancelled money/);
  });
});

// The production delta is a release artifact, generated and checked at release
// time (tabletap-release/2026-10-18/build-delta.py), not a file in the repo: a
// test pinning it to the schema would break every later change to a writer.
