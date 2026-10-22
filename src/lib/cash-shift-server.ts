import { returnedTrail } from "@/lib/refunds/trail";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import type { CashMovement } from "@/lib/cash-drawer";
import { type CashShift, type ShiftSum, type ShiftView, type TrailLine } from "@/lib/cash-shift";

/**
 * The cash drawer's shifts, read with the secret key: `cash_shifts`,
 * `cash_movements` and `payments` are the server's alone, and every caller
 * has already checked who is asking. Every read is scoped to one restaurant.
 */

const SHIFT_COLUMNS =
  "id, currency, opened_by, opened_at, opening_amount, closed_by, closed_at, counted_cash, expected_cash, difference, difference_note, explained_by";

/** The kinds of record a shift's trail shows, as entity → actions. */
const TRAIL: Record<string, string[]> = {
  order: ["cancelled", "refunded"],
  bill: ["written_off"],
  discount: ["discounted", "approved"],
  cash: ["created", "deleted"],
};

const numbers = (s: Record<string, unknown>): CashShift => ({
  ...(s as unknown as CashShift),
  opening_amount: Number(s.opening_amount),
  counted_cash: s.counted_cash == null ? null : Number(s.counted_cash),
  expected_cash: s.expected_cash == null ? null : Number(s.expected_cash),
  difference: s.difference == null ? null : Number(s.difference),
});

/** The shift open now, or null. */
export async function openShift(restaurantId: string): Promise<CashShift | null> {
  const { data, error } = await createAdminClient()
    .from("cash_shifts").select(SHIFT_COLUMNS)
    .eq("restaurant_id", restaurantId).is("closed_at", null).maybeSingle();
  if (error) throw new Error(`the open shift: ${error.message}`);
  return data ? numbers(data) : null;
}

/** Today's shifts — opened, closed, still open, or corrected today — oldest first. */
export async function todaysShifts(restaurantId: string, dayStart: Date): Promise<CashShift[]> {
  const db = createAdminClient();
  const rows = await everyRow<Record<string, unknown>>((a, b) => db.rpc("cash_shifts_for_day", {
    p_restaurant: restaurantId, p_day_start: dayStart.toISOString(),
  }).order("opened_at", { ascending: true }).order("id").range(a, b), "today's shifts");
  return rows.map(numbers);
}

/** The withdrawals taken during a shift, oldest first. */
export async function shiftWithdrawals(restaurantId: string, shiftId: string): Promise<CashMovement[]> {
  const { data, error } = await createAdminClient()
    .from("cash_movements").select("id, currency, kind, amount, note, actor_email, created_at")
    .eq("restaurant_id", restaurantId).eq("shift_id", shiftId).eq("kind", "withdrawal")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`the shift's withdrawals: ${error.message}`);
  return (data ?? []).map(m => ({ ...m, amount: Number(m.amount) })) as CashMovement[];
}

/**
 * What the drawer should hold for a shift: its opening, the cash taken while
 * it was open (net of cash handed back), minus its withdrawals. Up to `until`
 * — now for an open shift, its close for a closed one.
 */
export async function shiftSumOf(restaurantId: string, shift: CashShift, until: Date = new Date()): Promise<ShiftSum> {
  const db = createAdminClient();
  // Every row of the shift: a busy shift has more payments than one read
  // returns, and a drawer summed from part of them is a shortfall nobody made.
  // The database sums all of them in the stored currency, using the very
  // same calculation the blind close signs under the money lock.
  const { data, error } = await db.rpc("cash_shift_totals", {
    p_restaurant: restaurantId, p_shift: shift.id, p_until: until.toISOString(),
  });
  if (error || !data) throw new Error(`the shift's total: ${error?.message ?? "shift not found"}`);
  return { opening: Number(data.opening), cashSales: Number(data.cashSales), withdrawn: Number(data.withdrawn), expected: Number(data.expected) };
}

/** What happened to the money during a shift: refunds, discounts, cancellations, withdrawals. */
export async function shiftTrail(restaurantId: string, shift: CashShift): Promise<TrailLine[]> {
  const to = shift.closed_at ?? new Date().toISOString();
  const db = createAdminClient();
  const data = await everyRow<TrailLine>((a, b) => db
    .from("user_logs").select("entity, action, detail, actor_email, created_at")
    .eq("restaurant_id", restaurantId)
    .in("entity", Object.keys(TRAIL))
    .gte("created_at", shift.opened_at).lte("created_at", to)
    .order("created_at", { ascending: true }).order("id").range(a, b), "the shift's trail");
  const returns = await returnedTrail(restaurantId, shift.opened_at, to);
  return [...data.filter(l => TRAIL[l.entity]?.includes(l.action)), ...returns]
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Today's shifts as the register close shows them, each with its sum and trail. */
export async function todaysShiftViews(restaurantId: string, dayStart: Date): Promise<ShiftView[]> {
  const shifts = await todaysShifts(restaurantId, dayStart);
  return await Promise.all(
    shifts.map(async shift => {
      const [sum, withdrawals, trail] = await Promise.all([
        shiftSumOf(restaurantId, shift),
        shiftWithdrawals(restaurantId, shift.id),
        shiftTrail(restaurantId, shift),
      ]);
      return { shift, sum, withdrawals, trail };
    }),
  );
}
