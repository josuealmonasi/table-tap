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
  it("preserves deployed writers, with only the shared overlap lock added", () => {
    for (const name of writers) {
      const normalize = (s: string) => s.replace(/  perform public\.lock_restaurant_money\([^\n]+\);\n/g, "");
      expect(createHash("sha256").update(normalize(definition(schema, name))).digest("hex"), name).toBe(legacyWriters[name]);
    }
  });
  it("gates strict order enforcement on versioned writers, never existing coverage", () => {
    for (const name of ["guard_allocated_order", "check_paid_coverage"]) {
      expect(definition(schema, name), name).toContain("current_setting('tabletap.allocation_writer', true) is distinct from 'v1' then");
    }
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
