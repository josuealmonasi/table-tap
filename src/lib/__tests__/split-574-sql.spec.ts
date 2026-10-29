import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const definition = (name: string): string => {
  const all = [...schema.matchAll(/create or replace function public\.([a-z_0-9]+)\([\s\S]*?\$\$;/g)].filter(m => m[1] === name);
  return all.at(-1)?.[0] ?? "";
};

describe("#574 audit: splits and the money paths around them", () => {
  it("1: no split starts, holds or collects over an open whole-bill card page", () => {
    for (const fn of ["start_bill_split_v2", "reserve_split_slots_v1", "collect_split_slots_v1"]) {
      const body = definition(fn);
      const guard = body.indexOf("public.whole_bill_card_open_v1(p_restaurant,");
      expect(guard, fn).toBeGreaterThan(0);
      expect(body.slice(guard, guard + 200), fn).toContain("'paying'");
    }
    const open = definition("whole_bill_card_open_v1");
    // A part's own page is not a whole-bill hold, or one card part would block cash for another.
    expect(open).toContain("coalesce(c.metadata->>'split_model', '') <> '2'");
    expect(open).toContain("c.status = 'open'");
    // No age window: a late webhook must not make an unresolved page collectible (R1).
    expect(open).not.toContain("interval '35 minutes'");
  });
  it("2: a walked-out divided bill is forgiven whole, and the split ends", () => {
    const off = definition("write_off_remainder_v1");
    expect(off).toContain("if v_split.status = 'proposed' or v_split.model_version <> 2 then return jsonb_build_object('outcome', 'split'); end if;");
    expect(off).toContain("s.reserved_checkout_id is not null and s.payment_id is null");
    expect(off).toContain("not (v_split.order_ids <@ p_orders)");
    expect(off.indexOf("update bill_splits set status = 'done' where id = any(v_ended)")).toBeGreaterThan(0);
    // Open pages, not a part's stale card_checkout_at (R2).
    expect(off).not.toContain("card_checkout_at > now() - interval '35 minutes'");
  });
});
