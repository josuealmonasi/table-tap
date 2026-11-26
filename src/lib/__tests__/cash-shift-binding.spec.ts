import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectingShiftId } from "@/lib/collecting-shift";
import { checkClosedShifts } from "../../../scripts/money-shifts.mjs";

// bl39 finding 2: a cashier takes MX$80 at 11:59 on a MX$100 float; another
// counts MX$180 and closes at noon while the sale is still on its way. Stamped
// by time, the sale landed after the close: shift A read MX$80 over, and the
// next shift a matching MX$80 short. The sale is now bound to the shift open
// when it arrived, and every reader counts it there.
const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string): string => sql.split(`create or replace function public.${name}(`).at(-1)!.split("$$;")[0]!;

it("reads the open shift as the sale starts, and never refuses a sale for it", async () => {
  const db = (answer: { data: unknown; error: unknown }) => ({ from: () => {
    const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => answer };
    return q;
  } }) as unknown as Parameters<typeof collectingShiftId>[0];
  expect(await collectingShiftId(db({ data: { id: "A" }, error: null }), "r")).toBe("A");
  expect(await collectingShiftId(db({ data: null, error: null }), "r")).toBeNull();
  expect(await collectingShiftId(db({ data: null, error: { message: "down" } }), "r")).toBeNull();
});

it("the till binds the receipt under the money lock, to the shift even if it closed meanwhile", () => {
  const v3 = fn("ring_pos_sale_v3");
  expect(v3).toContain("p_inventory boolean, p_threshold int, p_cash_shift uuid\n");
  expect(v3.indexOf("lock_restaurant_money")).toBeLessThan(v3.indexOf("public.ring_pos_sale_v2("));
  expect(v3).toContain("update payments set cash_shift_id = s.id");
  // Not only an open shift: a closed one keeps the sale it collected.
  expect(v3).toContain("select * into s from cash_shifts where restaurant_id = p_restaurant and id = p_cash_shift;");
  expect(v3).toContain("'lateForShift', s.closed_at is not null");
  const route = readFileSync("src/app/api/pos/order/route.ts", "utf8");
  expect(route.indexOf("collectingShiftId(db, actor.restaurantId)")).toBeLessThan(route.indexOf("existingTicket(db"));
  expect(route).toContain("p_cash_shift: cashShift");
});

it("the shift sum and the day's shifts count a bound receipt in its own shift, not by its time", () => {
  const totals = fn("cash_shift_totals");
  expect(totals).toContain("p.cash_shift_id = s.id and coalesce(p.recorded_at, p.created_at) <= p_until");
  expect(totals).toContain("p.cash_shift_id is null and p.created_at between s.opened_at and s.until_at");
  expect(fn("cash_shifts_for_day")).toContain("p.cash_shift_id = s.id");
  // Added before the function that reads it, or the schema does not load.
  expect(sql.indexOf("alter table payments add column if not exists cash_shift_id"))
    .toBeLessThan(sql.indexOf("create or replace function public.cash_shift_totals("));
  expect(fn("keep_cash_shift_binding_v1")).toContain("raise exception 'receipt shift is immutable'");
});

it("the money gate rebuilds both shifts from the binding", () => {
  const A = { id: "A", restaurant_id: "r", currency: "MXN", opened_at: "2026-11-25T08:00:00Z", closed_at: "2026-11-25T12:00:00Z",
    opening_amount: 100, expected_cash: 100, counted_cash: 180, difference: 80 };
  const B = { id: "B", restaurant_id: "r", currency: "MXN", opened_at: "2026-11-25T12:00:00.500Z", closed_at: "2026-11-25T18:00:00Z",
    opening_amount: 50, expected_cash: 50, counted_cash: 50, difference: 0 };
  // Captured in A, posted one second after A closed, inside B's window.
  const late = { id: "p", restaurant_id: "r", currency: "MXN", method: "cash", actor_email: "cashier", amount: 80,
    created_at: "2026-11-25T12:00:01Z", recorded_at: "2026-11-25T12:00:01Z", cash_shift_id: "A" };
  const rows = { cash_shifts: [A, B], payments: [late], refund_operations: [], cash_movements: [], held_cash_receipts: [], user_logs: [], orders: [] };
  const bad: string[] = [];
  checkClosedShifts(rows, { ok: () => {}, bad: (m: string) => bad.push(m), info: () => {} });
  expect(bad).toEqual([]);
  // Unbound, the same receipt is B's by its time, and B's signed count disagrees.
  checkClosedShifts({ ...rows, payments: [{ ...late, cash_shift_id: null }] }, { ok: () => {}, bad: (m: string) => bad.push(m), info: () => {} });
  expect(bad.some(m => m.includes("shift B"))).toBe(true);
});
