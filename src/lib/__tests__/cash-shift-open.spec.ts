import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Opening a shift runs under the money lock (paths audit #6): the route calls
// open_cash_shift_v2 instead of inserting, and the function stamps its own time
// after the lock so it cannot start before a close that came first. The
// dialog's reference makes a retry return the shift it opened (bl39 #5).
const REF = "00000000-0000-4000-8000-000000000007";
type Answer = { id: string; replayed: boolean; closed: boolean } | null;
const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  answer: null as { id: string; replayed: boolean; closed: boolean } | null,
  error: null as { code: string } | null,
  logs: 0,
}));
vi.mock("@/lib/held-cash", () => ({ heldCashWaiting: async () => 0 }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", email: "cashier", role: "cashier" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => { state.logs++; } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    return { data: state.error ? null : state.answer, error: state.error };
  },
  from: () => { throw new Error("opening a shift must not insert directly"); },
}) }));
const route = await import("@/app/api/cash-shift/route");
const open = (body: Record<string, unknown> = { action: "open", amount: 500, ref: REF }) =>
  route.POST(new NextRequest("https://test/api/cash-shift", { method: "POST", body: JSON.stringify(body) }));
const fresh: Answer = { id: "s1", replayed: false, closed: false };
beforeEach(() => { state.calls.length = 0; state.answer = fresh; state.error = null; state.logs = 0; });

it("opens through open_cash_shift_v2 with the dialog's reference, never a direct insert", async () => {
  const res = await open();
  expect(await res.json()).toEqual({ ok: true, id: "s1", closed: false });
  expect(state.calls).toEqual([{ name: "open_cash_shift_v2", args: { p_restaurant: "r", p_actor: "cashier", p_amount: 500, p_ref: REF } }]);
  expect(state.logs).toBe(1);
});

it("bl39 #5: a delayed retry returns the original shift, closed since, and logs no second opening", async () => {
  state.answer = { id: "s1", replayed: true, closed: true };
  const res = await open();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, id: "s1", closed: true });
  expect(state.logs).toBe(0);
});

it("refuses an opening without a reference", async () => {
  const res = await open({ action: "open", amount: 500 });
  expect(res.status).toBe(400);
  expect(state.calls).toEqual([]);
});

it("the same reference with another amount is a conflict", async () => {
  state.error = { code: "PT409" };
  expect((await (await open()).json()).error).toBe("apiErr.retryConflict");
});

it("answers 'already open' when another shift is open", async () => {
  state.answer = null;
  const res = await open();
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("apiErr.shiftAlreadyOpen");
});

it("takes the money lock, finds the reference, then stamps the opening", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  for (const name of ["open_cash_shift(", "open_cash_shift_v2("]) {
    const fn = sql.split(`create or replace function public.${name}`)[1]!.split("$$;")[0]!;
    expect(fn.indexOf("perform public.lock_restaurant_money(p_restaurant);")).toBeGreaterThan(-1);
    expect(fn.indexOf("clock_timestamp()")).toBeGreaterThan(fn.indexOf("lock_restaurant_money"));
  }
  const v2 = sql.split("create or replace function public.open_cash_shift_v2(")[1]!.split("$$;")[0]!;
  expect(v2.indexOf("open_ref = p_ref")).toBeLessThan(v2.indexOf("closed_at is null"));
  expect(sql).toContain("create unique index if not exists cash_shifts_open_once on cash_shifts(restaurant_id, open_ref) where open_ref is not null;");
  // The new parameter is required: no default.
  expect(sql).toContain("open_cash_shift_v2(p_restaurant uuid, p_actor text, p_amount numeric, p_ref uuid)\n");
});

it("the dialog keeps one reference for an opening until it gets a definite answer", () => {
  const dialog = readFileSync("src/components/dashboard/cash/CashMovementDialog.tsx", "utf8");
  expect(dialog).toContain('openRef.current ??= crypto.randomUUID()');
  expect(dialog).toContain('JSON.stringify({ action: "open", amount, ref: openRef.current })');
  expect(dialog).toContain("(res.ok || [400, 403, 409].includes(res.status))) openRef.current = null");
});
