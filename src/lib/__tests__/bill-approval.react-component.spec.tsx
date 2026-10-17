import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";

const { state, mutate, rpc, log } = vi.hoisted(() => ({
  state: { amount: 10, total: 1000, missing: false, readError: false },
  mutate: vi.fn(), rpc: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1", email: "manager", role: "manager" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: log }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/apply-write-off", () => ({ applyWriteOff: mutate }));
vi.mock("@/lib/apply-bill-discount", () => ({ applyToOrders: mutate }));
vi.mock("@/lib/coupon-service", () => ({
  findCoupon: async () => ({ id: "c1", code: "FREE", kind: "percent", value: 100 }),
  couponProblem: () => null,
  toAppliedCoupon: (coupon: unknown) => coupon,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc,
  from: (table: string) => {
    const answer = () => table === "orders"
      ? { data: state.missing ? [] : [{ id: "o1", total: state.total, paid: false, written_off: false, status: "received", session_id: "s1" }], error: state.readError ? { message: "down" } : null }
      : { data: { id: "ask", order_ids: ["o1"], amount: state.amount, code: "FREE", reason: "walkout", status: "pending" }, error: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "update"]) q[m] = () => q;
    q.maybeSingle = async () => answer();
    q.then = (resolve: (a: unknown) => unknown) => Promise.resolve(answer()).then(resolve);
    return q;
  },
}) }));
const { POST: writeOff } = await import("@/app/api/bill/write-off/approve/route");
const { POST: discount } = await import("@/app/api/bill/discount/approve/route");
const request = (reviewedAmount?: number, approve = true) => new NextRequest("http://localhost/api/bill/approve", {
  method: "POST", body: JSON.stringify({ requestId: "ask", approve, reviewedAmount }),
});
beforeEach(() => {
  Object.assign(state, { amount: 10, total: 1000, missing: false, readError: false });
  mutate.mockReset().mockResolvedValue(true);
  rpc.mockReset().mockResolvedValue({ data: "approved", error: null });
  log.mockReset();
});
for (const [kind, route] of [["write-off", writeOff], ["discount", discount]] as const) {
  describe(kind, () => {
    it("refuses a request showing ten pesos whose order ids act on a thousand", async () => {
      expect((await route(request(10))).status).toBe(409);
      expect(mutate).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
    it("refuses an approval whose screen showed an older amount", async () => {
      state.amount = state.total = 1000;
      expect((await route(request(10))).status).toBe(409);
      expect(mutate).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
    it("requires the amount the manager saw", async () => {
      state.amount = state.total = 1000;
      expect((await route(request())).status).toBe(400);
      expect(mutate).not.toHaveBeenCalled();
    });
    it("applies a matching request in one guarded transaction", async () => {
      state.amount = state.total = 1000;
      expect((await route(request(1000))).status).toBe(200);
      expect(rpc).toHaveBeenCalledWith(kind === "discount" ? "approve_discount_request" : "approve_write_off_request", expect.objectContaining({
        p_request: "ask", p_restaurant: "r1", p_actor: "manager", p_amount: 1000,
      }));
      expect(mutate).not.toHaveBeenCalled();
    });
    it("refuses if the amount changes again before the transaction locks it", async () => {
      state.amount = state.total = 1000;
      rpc.mockResolvedValue({ data: "changed", error: null });
      expect((await route(request(1000))).status).toBe(409);
      expect(log).not.toHaveBeenCalled();
    });
    it("keeps a request pending when its orders could not be read", async () => {
      state.readError = true;
      expect((await route(request(10))).status).toBe(503);
      expect(mutate).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
    it("still allows a manager to reject a request", async () => {
      expect((await route(request(10, false))).status).toBe(200);
      expect(mutate).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
  });
}
it("approval request tables grant only scoped reads to authenticated clients", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  for (const table of ["discount_requests", "write_off_requests"]) {
    expect(sql.includes(`revoke insert, update, delete on ${table} from authenticated`)).toBe(true);
    expect(sql.includes(`grant select on ${table} to authenticated`)).toBe(true);
    expect(sql).not.toMatch(new RegExp(`on ${table} for all`));
  }
});

it("rechecks the approval amount under order and request locks", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  for (const name of ["approve_write_off_request", "approve_discount_request"]) {
    const fn = sql.split(`create or replace function public.${name}(`)[1]?.split("end; $$;")[0];
    expect(fn).toContain("v_request.amount <> p_amount");
    expect(fn).toContain("order by id for update");
    expect(fn).toContain("cardinality(v_request.order_ids)");
    expect(fn).toContain("restaurant_id = p_restaurant");
  }
});
