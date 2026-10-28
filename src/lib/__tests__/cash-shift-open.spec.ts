import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Opening a shift runs under the money lock (paths audit #6): the route calls
// open_cash_shift instead of inserting, and the function stamps its own time
// after the lock so it cannot start before a close that came first.
const state = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[], answer: "s1" as string | null }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", email: "cashier", role: "cashier" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => { state.calls.push({ name, args }); return { data: state.answer, error: null }; },
  from: () => { throw new Error("opening a shift must not insert directly"); },
}) }));
const route = await import("@/app/api/cash-shift/route");
const open = () => route.POST(new NextRequest("https://test/api/cash-shift", { method: "POST", body: JSON.stringify({ action: "open", amount: 500 }) }));
beforeEach(() => { state.calls.length = 0; state.answer = "s1"; });

it("opens through open_cash_shift, never a direct insert", async () => {
  const res = await open();
  expect(await res.json()).toEqual({ ok: true, id: "s1" });
  expect(state.calls).toEqual([{ name: "open_cash_shift", args: { p_restaurant: "r", p_actor: "cashier", p_amount: 500 } }]);
});

it("answers 'already open' when another shift is open", async () => {
  state.answer = null;
  const res = await open();
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("apiErr.shiftAlreadyOpen");
});

it("takes the money lock before stamping the opening", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const fn = sql.split("create or replace function public.open_cash_shift(")[1]!.split("$$;")[0]!;
  expect(fn.indexOf("perform public.lock_restaurant_money(p_restaurant);")).toBeGreaterThan(-1);
  expect(fn.indexOf("clock_timestamp()")).toBeGreaterThan(fn.indexOf("lock_restaurant_money"));
});
