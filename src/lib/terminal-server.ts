import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { orderCode } from "@/lib/types";
import { depositDays, localDay, type DepositDay, type DepositRecord, type TerminalPayment } from "./terminal";

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

interface OrderRead {
  tip: number;
  total: number;
  status: string;
  cancelled_at: string | null;
}

interface PaymentRead {
  id: string;
  amount: number;
  tip: number;
  order_id: string | null;
  terminal_ref: string | null;
  created_at: string;
  recorded_at: string | null;
  allocation_origin: string;
  /** Embedded through the foreign key, so no list of ids rides in the URL. */
  orders: OrderRead | null;
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
  const since = new Date(now.getTime() - TERMINAL_WINDOW_DAYS * 86_400_000);
  const restaurant = await db.from("restaurants").select("currency, terminal_fee_pct, terminal_settle_days").eq("id", restaurantId).single();
  if (restaurant.error || !restaurant.data) throw new Error(`Could not read the restaurant: ${restaurant.error?.message}`);
  const currency = depositCurrency ?? restaurant.data.currency;
  const [payments, deposits] = await Promise.all([
    everyRow<PaymentRead>((a, b) => db.from("payments")
      .select("id, amount, tip, order_id, terminal_ref, created_at, recorded_at, allocation_origin, orders(tip, total, status, cancelled_at)")
      .eq("restaurant_id", restaurantId).eq("currency", currency).eq("method", "card").is("stripe_payment_intent", null)
      .eq("orders.restaurant_id", restaurantId)
      .gte("created_at", since.toISOString()).order("id").range(a, b)
      .overrideTypes<PaymentRead[], { merge: false }>(), "the terminal's payments"),
    everyRow<DepositRecord>((a, b) => db.from("terminal_deposits")
      .select("sales_day, currency, expected, received, note, recorded_by, created_at")
      .eq("restaurant_id", restaurantId).eq("currency", currency).gte("sales_day", localDay(since, timeZone))
      .order("sales_day").range(a, b), "the deposits"),
  ]);

  const cancellations = await everyRow<{ order_id: string }>((a, b) => db.from("order_adjustments")
    .select("order_id").eq("restaurant_id", restaurantId).order("id").range(a, b), "the cancellation adjustments");
  const adjusted = new Set(cancellations.map(a => a.order_id));
  const earlierVoids = await voidedSince(restaurantId, since, adjusted, currency);
  const voidedAt = (p: PaymentRead): string | null =>
    p.allocation_origin === "legacy" && !adjusted.has(p.order_id ?? "") && p.orders?.status === "cancelled" ? p.orders.cancelled_at ?? p.created_at : null;
  const tipOf = (p: PaymentRead): number => {
    if (Number(p.tip) > 0) return Number(p.tip);
    const order = p.orders;
    return order && Math.abs(Number(order.total) - Number(p.amount)) < 0.005 ? Number(order.tip) || 0 : 0;
  };

  const feePct = Number(restaurant.data.terminal_fee_pct);
  const settleDays = Number(restaurant.data.terminal_settle_days);
  const returns = await everyRow<{ amount: number; tip: number; completed_at: string }>((a, b) => db.from("refund_operations")
    .select("amount, tip, completed_at").eq("restaurant_id", restaurantId).eq("currency", currency).eq("source", "terminal")
    .eq("status", "succeeded").gte("completed_at", since.toISOString()).order("id").range(a, b), "the terminal returns");
  const returned: TerminalPayment[] = returns.map(r => ({
    amount: Number(r.amount), tip: Number(r.tip), created_at: r.completed_at, returned_at: r.completed_at,
  }));
  const rows = payments.map(p => ({ ...p, tip: tipOf(p), voided_at: voidedAt(p) }));
  const byDay: Record<string, TerminalPaymentRow[]> = {};
  for (const p of rows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const day = localDay(p.created_at, timeZone);
    (byDay[day] ??= []).push({
      id: p.id, at: p.created_at, amount: Number(p.amount), tip: p.tip, ref: p.terminal_ref,
      code: p.order_id ? orderCode(p.order_id) : null, voided: p.voided_at !== null,
    });
  }
  return {
    days: depositDays([...rows, ...earlierVoids, ...returned], deposits, feePct, settleDays, timeZone, localDay(now, timeZone), localDay(since, timeZone)),
    payments: byDay,
    feePct,
    settleDays,
  };
}

interface VoidRead {
  amount: number;
  order_id: string;
  created_at: string;
  orders: { cancelled_at: string };
}

/** Terminal charges taken before `since` whose sale was cancelled after it. */
async function voidedSince(restaurantId: string, since: Date, adjusted: Set<string>, currency: string): Promise<TerminalPayment[]> {
  const db = createAdminClient();
  const voided = await everyRow<VoidRead>((a, b) => db.from("payments")
    .select("amount, order_id, created_at, orders!inner(cancelled_at)")
    .eq("restaurant_id", restaurantId).eq("currency", currency).eq("method", "card").is("stripe_payment_intent", null)
    .eq("allocation_origin", "legacy").lt("created_at", since.toISOString())
    .eq("orders.restaurant_id", restaurantId).eq("orders.status", "cancelled")
    .gte("orders.cancelled_at", since.toISOString())
    .order("id").range(a, b)
    .overrideTypes<VoidRead[], { merge: false }>(), "the charges voided");
  return voided.filter(p => !adjusted.has(p.order_id)).map(p => ({ amount: Number(p.amount), tip: 0, created_at: p.created_at, voided_at: p.orders.cancelled_at }));
}
