import { returnedTrail } from "@/lib/refunds/trail";
import { returnedAdjustments } from "@/lib/refunds/adjustments";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import type { CorteAdjustment, CortePayment } from "@/lib/corte";
import type { CashMovement } from "@/lib/cash-drawer";
import { shiftSum, type CashShift, type ShiftSum, type ShiftView, type TrailLine } from "@/lib/cash-shift";

/**
 * The cash drawer's shifts, read with the secret key: `cash_shifts`,
 * `cash_movements` and `payments` are the server's alone, and every caller
 * has already checked who is asking. Every read is scoped to one restaurant.
 */

const SHIFT_COLUMNS =
  "id, opened_by, opened_at, opening_amount, closed_by, closed_at, counted_cash, expected_cash, difference, difference_note, explained_by";

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

/** Today's shifts — opened since the day began, or still open — oldest first. */
export async function todaysShifts(restaurantId: string, dayStart: Date): Promise<CashShift[]> {
  const { data, error } = await createAdminClient()
    .from("cash_shifts").select(SHIFT_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .or(`opened_at.gte.${dayStart.toISOString()},closed_at.is.null`)
    .order("opened_at", { ascending: true });
  if (error) throw new Error(`today's shifts: ${error.message}`);
  return (data ?? []).map(numbers);
}

/** The withdrawals taken during a shift, oldest first. */
export async function shiftWithdrawals(restaurantId: string, shiftId: string): Promise<CashMovement[]> {
  const { data, error } = await createAdminClient()
    .from("cash_movements").select("id, kind, amount, note, actor_email, created_at")
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
  const { data: restaurant, error } = await db.from("restaurants").select("currency").eq("id", restaurantId).single();
  if (error || !restaurant) throw new Error("Could not read the drawer currency");
  const from = shift.opened_at;
  const to = (shift.closed_at ? new Date(shift.closed_at) : until).toISOString();
  // Every row of the shift: a busy shift has more payments than one read
  // returns, and a drawer summed from part of them is a shortfall nobody made.
  const [payments, handedBack, withdrawals, returns] = await Promise.all([
    everyRow<CortePayment>((a, b) => db.from("payments").select("actor_email, amount, method")
      .eq("restaurant_id", restaurantId).eq("currency", restaurant.currency).gte("created_at", from).lte("created_at", to)
      .order("id").range(a, b), "the shift's payments"),
    everyRow<CorteAdjustment>((a, b) => db.from("user_logs").select("action, detail")
      .eq("restaurant_id", restaurantId).eq("action", "refunded").gte("created_at", from).lte("created_at", to)
      .order("id").range(a, b), "the shift's handbacks"),
    shiftWithdrawals(restaurantId, shift.id),
    returnedAdjustments(restaurantId, from, to, restaurant.currency),
  ]);
  return shiftSum(shift.opening_amount, payments, [...handedBack, ...returns], withdrawals);
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
