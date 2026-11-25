import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import type { CouponRow } from "@/lib/coupon-service";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const { coupon, rpc } = vi.hoisted(() => ({
  coupon: {
    id: "coupon-1", code: "TACO50", kind: "percent", value: 50, min_subtotal: 80,
    staff_only: false, max_uses: 1, uses_count: 0, active: true, starts_at: null, ends_at: null,
  } satisfies CouponRow,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc,
  from: () => {
    const query = {
      select: () => query, eq: () => query, ilike: () => query,
      maybeSingle: async () => ({ data: coupon, error: null }),
    };
    return query;
  },
}) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { allows_coupons: true } }) }));

const { claimCheckoutCoupon } = await import("@/lib/checkout/claim-coupon");

beforeEach(() => rpc.mockReset());

it("claims an unchanged coupon using the exact terms and the pre-coupon subtotal", async () => {
  rpc.mockResolvedValueOnce({ data: 1, error: null });
  expect(await claimCheckoutCoupon("r1", coupon.code, 100)).toEqual({ coupon });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("redeem_coupon", {
    p_coupon_id: coupon.id,
    p_restaurant: "r1",
    p_quote: { id: coupon.id, code: "TACO50", kind: "percent", value: 50,
      min_subtotal: 80, staff_only: false, eligible_subtotal: 100 },
  });
});

it.each([
  [{ data: null, error: { code: "PT022" } }, "changed"],
  [{ data: null, error: null }, "limitReached"],
])("answers a refused locked claim as %j with reason %s", async (reply, reason) => {
  rpc.mockResolvedValueOnce(reply);
  const result = await claimCheckoutCoupon("r1", coupon.code, 100);
  if (!("refused" in result)) throw new Error("Expected a coupon refusal");
  expect(result.refused.status).toBe(409);
  expect(await result.refused.json()).toEqual({ couponReason: reason });
});

it("asks diners to review their cart or bill in both languages", () => {
  expect(en.coupon.changed).toContain("Review your cart");
  expect(es.coupon.changed).toContain("Revisa tu carrito");
  expect(en.apiErr.billCouponChanged).toContain("Review your bill");
  expect(es.apiErr.billCouponChanged).toContain("Revisa tu cuenta");
});

const schema = readFileSync("supabase/schema.sql", "utf8");
const reset = readFileSync("supabase/drop.sql", "utf8");
const claim = schema.split("function public.redeem_coupon(p_coupon_id uuid, p_restaurant uuid, p_quote jsonb)")[1].split("$$;")[0];

it("rechecks the audience, price terms and eligible subtotal between locking and claiming", () => {
  expect(claim).toMatch(/where id = p_coupon_id and \(p_restaurant is null or restaurant_id = p_restaurant\)\s+for update/);
  expect(claim).toMatch(/\(v_coupon.staff_only, v_coupon.kind, v_coupon.value, v_coupon.min_subtotal, v_coupon.code\) is distinct from\s*\(\(p_quote->>'staff_only'\)::boolean, p_quote->>'kind', \(p_quote->>'value'\)::numeric,\s*\(p_quote->>'min_subtotal'\)::numeric, p_quote->>'code'\)/);
  expect(claim).toContain("(v_coupon.min_subtotal <= (p_quote->>'eligible_subtotal')::numeric) is not true");
  const refusal = claim.indexOf("errcode = 'PT022'");
  expect(refusal).toBeGreaterThan(claim.indexOf("for update"));
  expect(refusal).toBeLessThan(claim.indexOf("update coupons set uses_count"));
});

it("evaluates both schedule boundaries and the use cap using the locked row", () => {
  expect(claim).toMatch(/for update;[\s\S]+v_now := clock_timestamp\(\);\s*if not v_coupon.active or v_coupon.uses_count >= v_coupon.max_uses\s*or v_coupon.starts_at > v_now or v_coupon.ends_at <= v_now then return null; end if;\s*update coupons/);
  expect(claim).not.toContain("now()");
  expect(schema).toMatch(/function public.redeem_coupon\(p_coupon_id uuid\)[\s\S]+?select public.redeem_coupon\(p_coupon_id, null, null\)/);
});

it("revokes broad writes and gives managers only coupon term columns for insert and update", () => {
  expect(schema).toMatch(/revoke insert, update on coupons from public, authenticated;\s*grant insert \(restaurant_id, code, kind, value, min_subtotal, max_uses, active, starts_at, ends_at, staff_only\),\s*update \(kind, value, min_subtotal, max_uses, active, starts_at, ends_at, staff_only\)\s*on coupons to authenticated;/);
  expect(schema).toMatch(/on coupons for all\s+using \(has_role\(restaurant_id, array\['manager'\]\)\)\s+with check \(has_role\(restaurant_id, array\['manager'\]\)\)/);
});

it("keeps the new claim service-only and resettable", () => {
  const signature = "public.redeem_coupon(uuid, uuid, jsonb)";
  expect(schema).toContain(`revoke all on function ${signature} from public, anon, authenticated;`);
  expect(schema).toContain(`grant execute on function ${signature} to service_role;`);
  expect(reset).toContain(`drop function if exists ${signature};`);
});
