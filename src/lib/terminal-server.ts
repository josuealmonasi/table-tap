import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { subtractLocalDays } from "@/lib/day-window";
import { orderCode } from "@/lib/types";
import { depositDays, localDay, type DepositDay, type DepositRecord, type TerminalPayment } from "./terminal";

/** The recent window; older unsigned days and late receipts remain visible. */
export const TERMINAL_WINDOW_DAYS = 14;

export interface TerminalPaymentRow {
  id: string;
  at: string;
  amount: number;
  tip: number;
  ref: string | null;
  /** The sale it paid, as the board names it; null for a bill settled at a table. */
  code: string | null;
  /** Its sale was cancelled and the charge voided on the terminal. */
  voided: boolean;
}

export interface TerminalView {
  days: DepositDay[];
  /** Each day's payments, by day. */
  payments: Record<string, TerminalPaymentRow[]>;
  feePct: number;
  settleDays: number;
}

interface PaymentRead extends TerminalPayment {
  id: string;
  order_id: string | null;
  terminal_ref: string | null;
}

/**
 * The restaurant's own terminal over the last two weeks: every card payment
 * that did not go through Stripe, by day, with what should be deposited.
 * Read with the secret key, scoped to the restaurant on every read; the page
 * that shows it is the managers'.
 *
 * A counter sale keeps its tip on the order, not the payment, so a payment
 * that settled a whole order takes the order's tip.
 *
 * A cancelled sale's charge was voided on the terminal, dated by when it was
 * cancelled — before that was kept, by the sale itself, as the same day. A
 * sale from before the window that was voided inside it is read too: the
 * bank takes it out of a deposit the window lists.
 */
export async function readTerminal(restaurantId: string, timeZone: string, now = new Date(), depositCurrency?: string): Promise<TerminalView> {
  const db = createAdminClient();
  const since = subtractLocalDays(now, TERMINAL_WINDOW_DAYS, timeZone);
  const restaurant = await db.from("restaurants").select("currency, terminal_fee_pct, terminal_settle_days").eq("id", restaurantId).single();
  if (restaurant.error || !restaurant.data) throw new Error(`Could not read the restaurant: ${restaurant.error?.message}`);
  const currency = depositCurrency ?? restaurant.data.currency;
  // Read complete days, including old unreconciled sales and their allocations.
  // Joined through foreign keys in PostgreSQL, so no list of ids rides in the URL.
  // A creation-time window alone drops both a day's morning and offline recovery.
  const [ledger, deposits] = await Promise.all([
    everyRow<PaymentRead>((a, b) => db.rpc("terminal_deposit_ledger_v1", { p_restaurant: restaurantId, p_currency: currency })
      .order("id").range(a, b), "the terminal's payments and returns"),
    everyRow<DepositRecord>((a, b) => db.from("terminal_deposits")
      .select("sales_day, currency, expected, received, note, recorded_by, created_at, payment_ids, return_ids, snapshot_at, fee_pct")
      .eq("restaurant_id", restaurantId).eq("currency", currency)
      .order("sales_day").range(a, b), "the deposits"),
  ]);
  // Terminal charges taken before `since` whose sale was cancelled after it
  // are in this ledger too, so their later return can reach the next deposit.
  const rows = ledger.filter(p => !p.returned_at);
  const feePct = Number(restaurant.data.terminal_fee_pct);
  const settleDays = Number(restaurant.data.terminal_settle_days);
  const days = depositDays(ledger, deposits, feePct, settleDays, timeZone, localDay(now, timeZone))
    .filter(d => d.day >= localDay(since, timeZone) || !d.deposit || d.late !== 0);
  const visible = new Set(days.map(d => d.day));
  const byDay: Record<string, TerminalPaymentRow[]> = {};
  for (const p of rows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const day = localDay(p.created_at, timeZone);
    if (!visible.has(day)) continue;
    (byDay[day] ??= []).push({
      id: p.id, at: p.created_at, amount: Number(p.amount), tip: Number(p.tip), ref: p.terminal_ref,
      code: p.order_id ? orderCode(p.order_id) : null, voided: Boolean(p.voided_at) || ledger.filter(r => r.returned_at && r.payment_id === p.id).reduce((n, r) => n + Number(r.amount), 0) >= Number(p.amount),
    });
  }
  return {
    days,
    payments: byDay,
    feePct,
    settleDays,
  };
}
