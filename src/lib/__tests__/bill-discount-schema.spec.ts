import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
const body = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];
const writers = ["apply_bill_discount", "approve_discount_request_v2"];

it("F1 refuses the stale MX$110 quote after a MX$220 bill becomes MX$200", () => {
  const f = body("apply_bill_discount");
  const recompute = "v_amount := greatest(0, least(v_total, round(case when v_coupon.kind = 'percent'";
  expect(f.includes(recompute), "50% of locked MX$200 is MX$100; accepting the old MX$110 removes MX$10 too much").toBe(true);
  expect(f).toContain("then v_total * v_coupon.value / 100 else v_coupon.value end, 2)))");
  expect(f.indexOf(recompute)).toBeGreaterThan(f.indexOf("for update;"));
  expect(f.indexOf("if v_amount <> p_amount then return 'changed'; end if;" )).toBeGreaterThan(f.indexOf(recompute));
  expect(f.indexOf("if v_amount <> p_amount")).toBeLessThan(f.indexOf("redeem_coupon(v_coupon.id)"));
  const approval = body("approve_discount_request_v2");
  expect(f.slice(f.indexOf(recompute), f.indexOf("  -- Whole cents first;")))
    .toBe(approval.slice(approval.indexOf(recompute), approval.indexOf("  -- Whole cents first;")));
});

it("F1 rechecks minimum spend and edited coupon values by the approval writer's rule", () => {
  const direct = body("apply_bill_discount");
  const approval = body("approve_discount_request_v2");
  const eligibility = "if not found or not v_coupon.active\n     or v_coupon.starts_at > now() or v_coupon.ends_at <= now()\n     or v_total < v_coupon.min_subtotal\n     or v_coupon.uses_count >= v_coupon.max_uses then return 'changed'; end if;";
  expect(approval).toContain(eligibility);
  expect(direct.includes(eligibility), "a coupon read before locking cannot authorize an edited value or newly ineligible bill").toBe(true);
  expect(direct).toContain("if v_amount <> p_amount then return 'changed'; end if;");
});

// Offline arithmetic witness tied to the expressions in the schema. This is
// not PostgreSQL execution; the separate contracts pin both SQL implementations.
function sharesInSchema(f: string, totals: number[], approved: number): number[] {
  const total = totals.reduce((a, b) => a + b, 0);
  if (f.includes("round(p_amount * total / v_total, 2) amount")) {
    const shares = totals.map(v => Math.round(approved * v / total));
    shares[0] += approved - shares.reduce((a, b) => a + b, 0);
    return shares.map((v, i) => Math.max(0, Math.min(totals[i], v)));
  }
  expect(f).toContain("floor(p_amount * 100 * total / v_total) cents");
  const shares = totals.map(v => Math.floor(approved * v / total));
  const ranked = totals.map((v, i) => ({ i, remainder: approved * v % total }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const left = approved - shares.reduce((a, b) => a + b, 0);
  for (const { i } of ranked.slice(0, left)) shares[i]++;
  return shares;
}

it.each(writers)("F4 %s removes exactly MX$0.03 across six one-peso orders", name => {
  const shares = sharesInSchema(body(name), [100, 100, 100, 100, 100, 100], 3);
  expect(shares.reduce((a, b) => a + b, 0), "independent half-cent rounding plus a clamped negative remainder removes 5 cents instead of the approved 3").toBe(3);
  expect(shares).toEqual([1, 1, 1, 0, 0, 0]);
});

it.each(writers)("F4 %s ranks remainders deterministically and checks the written sum", name => {
  const f = body(name);
  expect(f).toContain("mod(p_amount * 100 * total, v_total) remainder");
  expect(f).toContain("row_number() over (order by remainder desc, id) position");
  expect(f).toContain("position <= round(p_amount * 100) - sum(cents) over ()");
  expect(f).toContain("returning a.amount");
  expect(f).toContain("if v_allocated <> p_amount then raise exception 'discount shares do not match approved amount'; end if;");
  expect(f.indexOf("if v_allocated <> p_amount")).toBeLessThan(f.indexOf("insert into coupon_redemptions"));
  for (const [totals, amount] of [[[1, 1, 1], 1], [[1, 2, 3], 6], [[0, 1, 99], 87], [[3, 7, 11], 13]] as [number[], number][]) {
    const shares = sharesInSchema(f, totals, amount);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
    expect(shares.every((v, i) => v >= 0 && v <= totals[i])).toBe(true);
  }
});

it("keeps the changed writers' signatures, server-only grants and drop parity", () => {
  const drop = readFileSync("supabase/drop.sql", "utf8");
  for (const signature of ["apply_bill_discount(uuid, uuid[], uuid, numeric)", "approve_discount_request_v2(uuid, uuid, text, numeric)"]) {
    expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    expect(drop).toContain(`drop function if exists public.${signature};`);
  }
});
