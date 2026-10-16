import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { CHECKOUT_HOLD_MINUTES } from "@/lib/service-reprice";

/** An order's recorded fee, and what decides whether we really have it. */
export interface FeeRow {
  platform_fee: number;
  paid: boolean;
  status: string;
  created_at: string;
  card_checkout_at: string | null;
}

/**
 * Whether an order's fee counts toward the month's ceiling: we took it, or a
 * checkout open right now may still take it.
 *
 * The fee is written on the order before the diner pays, so the ceiling used
 * to count fees we never had: an abandoned checkout stays behind until
 * Stripe's expiry event deletes it — for ever, where that event is not
 * delivered — and a sale cancelled after it was paid got its fee back with
 * the refund. Each brought the ceiling early, and orders past it paid
 * nothing. A checkout still open counts, so two diners paying at once are
 * never both priced under a ceiling only one of them fits under.
 */
export function feeCounts(o: FeeRow, now = Date.now()): boolean {
  if (o.status === "cancelled") return false;
  if (o.paid) return true;
  if (o.status !== "pending_payment") return false;
  const opened = Math.max(Date.parse(o.created_at), o.card_checkout_at ? Date.parse(o.card_checkout_at) : 0);
  return now - opened < CHECKOUT_HOLD_MINUTES * 60_000;
}

/**
 * What we have already taken from this restaurant in per-order fees this
 * calendar month, in cents.
 *
 * Summed from the orders themselves rather than asked of Stripe: a payment is
 * the worst moment to be waiting on somebody else's API, and the number has to
 * be reconcilable against what the owner can see in their own history — the
 * costs screen sums the same paid, uncancelled orders.
 *
 * The month is the calendar month in UTC. A restaurant's billing period does
 * not line up with it exactly, which means the ceiling can be a few days out
 * of step at the turn of a month — worth the simplicity until subscriptions
 * are common enough for anyone to notice.
 */
export async function feesTakenThisMonth(restaurantId: string, now = new Date()): Promise<number> {
  const since = new Date(now);
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  // Every row: a read stops at the server's row cap without saying so, and a
  // month summed from its first thousand orders is a ceiling never reached.
  const db = createAdminClient();
  const data = await everyRow<FeeRow>((a, b) => db
    .from("orders")
    .select("platform_fee, paid, status, created_at, card_checkout_at")
    .eq("restaurant_id", restaurantId)
    .gt("platform_fee", 0)
    .gte("created_at", since.toISOString())
    .order("id").range(a, b), "this month's fees");

  const pesos = data.filter(o => feeCounts(o, now.getTime())).reduce((sum, o) => sum + Number(o.platform_fee ?? 0), 0);
  return Math.round(pesos * 100);
}
