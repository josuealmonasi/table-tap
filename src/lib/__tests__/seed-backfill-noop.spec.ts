import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
function definition(name: string): string {
  return [...schema.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "g"))].at(-1)?.[0] ?? "";
}
const backfill = definition("backfill_payment_allocations");
const importer = definition("import_historical_return");

describe("complete seed backfill is read-only", () => {
  it("returns before a lock when receipts and historical reviews have nothing new to write", () => {
    const early = backfill.slice(backfill.indexOf("begin"), backfill.indexOf("-- Old and new writers"));
    expect(early).toContain("return jsonb_build_object('exact', 0, 'unresolved', 0);");
    expect(early).not.toMatch(/for update|lock_restaurant_money|set_config|\b(?:insert|update|delete)\b/i);
    expect(early).toContain("p_restaurant is null or rp.restaurant_id = p_restaurant");
    expect(early).toContain("p_restaurant is null or a.restaurant_id = p_restaurant");
  });
  it("keeps the receipt repair predicate identical to both backfill loops", () => {
    const predicate = "allocation_version = 0 or (allocation_quality = 'unresolved' and allocation_origin = 'legacy' and allocation_reason = 'Overlap receipt needs manager evidence')";
    const normalized = backfill.replaceAll("rp.", "").replace(/\s+/g, " ");
    expect(normalized.split(predicate)).toHaveLength(4);
  });
  it("never skips a cancellation, uncovered allocation or newly evidenced review", () => {
    const early = backfill.slice(backfill.indexOf("begin"), backfill.indexOf("-- Old and new writers"));
    for (const condition of ["rp.allocation_origin = 'legacy'", "o.status = 'cancelled'", "d.kind = 'cancel'", "d.id is null", "r.id is null",
      "f.historical_review and f.status = 'review'", "l.entity = 'order' and l.action = 'refunded'",
      "substring(l.detail from '(?:^| )order=([^ ]+)') = left(o.id::text, 8)", "used.historical_log_id = l.id"]) {
      expect(early).toContain(condition);
    }
    // Every log the importer could accept is included, even ambiguous logs.
    // We may enter needlessly, but must never skip evidence it could consume.
    expect(importer).toContain("entity = 'order' and action = 'refunded'");
    expect(importer).toContain("substring(detail from '(?:^| )order=([^ ]+)') = left(o.id::text, 8)");
    expect(importer).toContain("f.historical_log_id = user_logs.id");
    expect(early).not.toMatch(/stripe_payment_intent|collector=|amount=/);
  });
});
