import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow, everyRowIn } from "@/lib/paged";
import { CHECKOUT_HOLD_MINUTES } from "@/lib/service-reprice";

/** An order's recorded fee, and what decides whether we really have it. */
export interface FeeRow {
  platform_fee: number;
  paid: boolean;
  status: string;
  created_at: string;
  card_checkout_at: string | null;
  stripe_payment_intent: string | null;
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
 *
 * A cancelled sale gives its fee back only when its charge was its own. A
 * table's bill pays one fee for the whole sitting, written on its first
 * order; cancelling that order refunds its share of the charge and the same
 * share of the fee, and the rest stays ours. Not counting it would let the
 * month pass the ceiling, so a fee whose charge covered other orders, or
 * whose charge is not known, still counts — `sharedCharges` names them.
 */
export function feeCounts(o: FeeRow, now = Date.now(), sharedCharges: ReadonlySet<string> = new Set()): boolean {
  if (o.paid && o.status === "cancelled") {
    return !o.stripe_payment_intent || sharedCharges.has(o.stripe_payment_intent);
  }
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
    .select("platform_fee, paid, status, created_at, card_checkout_at, stripe_payment_intent")
    .eq("restaurant_id", restaurantId)
    .gt("platform_fee", 0)
    .gte("created_at", since.toISOString())
    .order("id").range(a, b), "this month's fees");

  // The charges behind this month's cancelled sales that also paid for other
  // orders: their fee was only partly refunded. A handful of rows a month.
  const intents = data.filter(o => o.paid && o.status === "cancelled" && o.stripe_payment_intent)
    .map(o => o.stripe_payment_intent as string);
  const covered = await everyRowIn<{ stripe_payment_intent: string }>(intents, (slice, from, to) => db
    .from("orders")
    .select("stripe_payment_intent")
    .eq("restaurant_id", restaurantId)
    .in("stripe_payment_intent", slice)
    .order("id").range(from, to), "the charges behind cancelled sales");
  const ordersPerCharge = new Map<string, number>();
  for (const o of covered) ordersPerCharge.set(o.stripe_payment_intent, (ordersPerCharge.get(o.stripe_payment_intent) ?? 0) + 1);
  const shared = new Set([...ordersPerCharge].filter(([, n]) => n > 1).map(([intent]) => intent));

  const pesos = data.filter(o => feeCounts(o, now.getTime(), shared)).reduce((sum, o) => sum + Number(o.platform_fee ?? 0), 0);
  return Math.round(pesos * 100);
}
