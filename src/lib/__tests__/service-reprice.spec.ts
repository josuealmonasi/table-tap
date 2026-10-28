import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Switching the service charge off takes it off the bills still open — and
 * off nothing whose total is already promised to somebody.
 *
 * The live demo's Mesa 8 owed MX$4.40 for a MX$4.00 salad after the owner had
 * switched the charge off: it was stored on the order when it was placed.
 *
 * The rules live in `reprice_open_service`, under the money lock (paths audit
 * #4); a dev probe runs them on real rows. These pin that each rule is still
 * there, and that the route reports a failure instead of a count.
 */
const state = vi.hoisted(() => ({ answer: { data: 2 as unknown, error: null as { message: string } | null }, calls: [] as unknown[] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: async (name: string, args: unknown) => { state.calls.push({ name, args }); return state.answer; } }),
}));
const { repriceOpenService, CHECKOUT_HOLD_MINUTES } = await import("@/lib/service-reprice");
const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = sql.split("create or replace function public.reprice_open_service(")[1]!.split("end; $$;")[0]!;

beforeEach(() => { state.calls.length = 0; state.answer = { data: 2, error: null }; });

describe("the open bills", () => {
  it("reprices through the locked function and returns its count", async () => {
    await expect(repriceOpenService("r1", 0)).resolves.toBe(2);
    expect(state.calls).toEqual([{ name: "reprice_open_service", args: { p_restaurant: "r1", p_pct: 0 } }]);
  });

  it("says it could not tell, rather than reporting a count, when the function fails", async () => {
    state.answer = { data: null, error: { message: "timeout" } };
    await expect(repriceOpenService("r1", 0)).resolves.toBeNull();
  });

  it("decides under the money lock and only ever lowers", () => {
    expect(fn.indexOf("perform public.lock_restaurant_money(p_restaurant);")).toBeGreaterThan(-1);
    expect(fn.indexOf("lock_restaurant_money")).toBeLessThan(fn.indexOf("update orders o set service_fee"));
    expect(fn).toContain("open.wanted < o.service_fee");
  });

  it("leaves every order whose total is already promised", () => {
    for (const rule of [
      "public.retained_order_coverage(p_restaurant, o.id) = 0",
      "not exists (select 1 from payments p where p.order_id = o.id)",
      "not exists (select 1 from payments p where p.session_id = o.session_id)",
      "s.status in ('proposed', 'locked')",
      "from discount_requests d",
      "from write_off_requests w",
      "o.stripe_session_id is null",
      "o.account_id is null",
    ]) expect(fn, rule).toContain(rule);
    expect(fn).toContain(`now() - interval '${CHECKOUT_HOLD_MINUTES} minutes'`);
  });
});
