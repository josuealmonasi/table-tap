import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { orderCode } from "@/lib/types";
import { depositDays, localDay, type DepositDay, type DepositRecord } from "./terminal";

/** How far back the terminal's days are listed. */
export const TERMINAL_WINDOW_DAYS = 14;

export interface TerminalPaymentRow {
  id: string;
  at: string;
  amount: number;
  tip: number;
  ref: string | null;
  /** The sale it paid, as the board names it; null for a bill settled at a table. */
  code: string | null;
}

export interface TerminalView {
  days: DepositDay[];
  /** Each day's payments, by day. */
  payments: Record<string, TerminalPaymentRow[]>;
  feePct: number;
  settleDays: number;
}

interface PaymentRead {
  id: string;
  amount: number;
  tip: number;
  order_id: string | null;
  terminal_ref: string | null;
  created_at: string;
}

/**
 * The restaurant's own terminal over the last two weeks: every card payment
 * that did not go through Stripe, by day, with what should be deposited.
 * Read with the secret key, scoped to the restaurant on every read; the page
 * that shows it is the managers'.
 *
 * A counter sale keeps its tip on the order, not the payment, so a payment
 * that settled a whole order takes the order's tip.
 */
export async function readTerminal(restaurantId: string, timeZone: string, now = new Date()): Promise<TerminalView> {
  const db = createAdminClient();
  const since = new Date(now.getTime() - TERMINAL_WINDOW_DAYS * 86_400_000);
  const [restaurant, payments, deposits] = await Promise.all([
    db.from("restaurants").select("terminal_fee_pct, terminal_settle_days").eq("id", restaurantId).single(),
    everyRow<PaymentRead>((a, b) => db.from("payments")
      .select("id, amount, tip, order_id, terminal_ref, created_at")
      .eq("restaurant_id", restaurantId).eq("method", "card").is("stripe_payment_intent", null)
      .gte("created_at", since.toISOString()).order("id").range(a, b), "the terminal's payments"),
    everyRow<DepositRecord>((a, b) => db.from("terminal_deposits")
      .select("sales_day, expected, received, note, recorded_by, created_at")
      .eq("restaurant_id", restaurantId).gte("sales_day", localDay(since, timeZone))
      .order("sales_day").range(a, b), "the deposits"),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`Could not read the restaurant: ${restaurant.error?.message}`);

  const orderIds = [...new Set(payments.map(p => p.order_id).filter((id): id is string => Boolean(id)))];
  const orders = orderIds.length
    ? await everyRow<{ id: string; tip: number; total: number }>((a, b) => db.from("orders")
        .select("id, tip, total").eq("restaurant_id", restaurantId).in("id", orderIds).order("id").range(a, b), "the orders paid")
    : [];
  const orderOf = new Map(orders.map(o => [o.id, o]));
  const tipOf = (p: PaymentRead): number => {
    if (Number(p.tip) > 0) return Number(p.tip);
    const order = p.order_id ? orderOf.get(p.order_id) : undefined;
    return order && Math.abs(Number(order.total) - Number(p.amount)) < 0.005 ? Number(order.tip) || 0 : 0;
  };

  const feePct = Number(restaurant.data.terminal_fee_pct);
  const settleDays = Number(restaurant.data.terminal_settle_days);
  const rows = payments.map(p => ({ ...p, tip: tipOf(p) }));
  const byDay: Record<string, TerminalPaymentRow[]> = {};
  for (const p of rows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const day = localDay(p.created_at, timeZone);
    (byDay[day] ??= []).push({
      id: p.id, at: p.created_at, amount: Number(p.amount), tip: p.tip, ref: p.terminal_ref,
      code: p.order_id ? orderCode(p.order_id) : null,
    });
  }
  return {
    days: depositDays(rows, deposits, feePct, settleDays, timeZone, localDay(now, timeZone)),
    payments: byDay,
    feePct,
    settleDays,
  };
}
