import { registerSubscriptionPrice } from "@/lib/subscription-price";
import type { PlanName } from "@/lib/plan";
import { runBatch, type PendingItem, type RecoveryContext, type Snapshot } from "./job";

/** An owner is told at least this long before the new price is billed. */
export const NOTICE_DAYS = 30;

/**
 * The renewal the new price starts at: the first period end on or after
 * `notBefore`, stepping a month at a time from the current one. Stripe bills
 * the new phase exactly there, so nothing depends on when this job runs.
 */
export function moveBoundary(periodEndSeconds: number, notBefore: Date): number {
  const boundary = new Date(periodEndSeconds * 1000);
  while (boundary.getTime() < notBefore.getTime()) boundary.setUTCMonth(boundary.getUTCMonth() + 1);
  return Math.floor(boundary.getTime() / 1000);
}

interface Move extends PendingItem {
  change_id: string;
  sent_at: string;
  plan_price_changes: { plan: string; new_monthly_price: number; effective_at: string };
  restaurants: { stripe_subscription_id: string | null };
}

/**
 * Moves each notified subscriber to the new price through a Stripe
 * subscription schedule: phase one keeps today's price until the boundary,
 * phase two bills the new price from then, with no proration. Only after the
 * notice was SENT, and never sooner than NOTICE_DAYS after it: nobody pays a
 * price they were not told about a month ahead. Founders have no notice row,
 * so they are never moved. Set once (stripe_schedule_id), never twice.
 */
export async function recoverPriceMoves(context: RecoveryContext) {
  const { db, client } = context;
  return runBatch("price moves", context, async (limit, offset = 0) => {
    const result = await db.from("plan_price_notices")
      .select("change_id, restaurant_id, created_at, sent_at, plan_price_changes!inner(plan, new_monthly_price, effective_at), restaurants!inner(stripe_subscription_id)", { count: "exact" })
      .not("sent_at", "is", null).is("stripe_schedule_id", null).is("move_skipped", null)
      .not("restaurants.stripe_subscription_id", "is", null)
      .order("created_at").order("change_id").order("restaurant_id").range(offset, offset + limit - 1).returns<Move[]>();
    return result as Snapshot<Move>;
  }, async row => {
    const skip = async (reason: string) => {
      const { error } = await db.from("plan_price_notices").update({ move_skipped: reason })
        .eq("change_id", row.change_id).eq("restaurant_id", row.restaurant_id).is("stripe_schedule_id", null);
      if (error) throw new Error("price move skip record unavailable");
      return true;
    };
    const sub = await client.subscriptions.retrieve(row.restaurants.stripe_subscription_id as string);
    const item = sub.items.data.length === 1 ? sub.items.data[0] : null;
    if (sub.cancel_at_period_end || sub.cancel_at) return await skip("cancels");
    if (!item || item.price.recurring?.interval !== "month" || item.price.recurring.interval_count !== 1 || item.price.currency !== "mxn") {
      return await skip("not_monthly");
    }
    // An overdue subscription is retried on a later run, not skipped for good.
    if (!["active", "trialing"].includes(sub.status)) throw new Error("subscription not in good standing");
    if (sub.schedule) return await skip("has_schedule");

    const change = row.plan_price_changes;
    const notBefore = new Date(Math.max(Date.parse(change.effective_at), Date.parse(row.sent_at) + NOTICE_DAYS * 86_400_000));
    const boundary = moveBoundary(item.current_period_end, notBefore);
    const cents = Math.round(Number(change.new_monthly_price) * 100);
    const product = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
    const price = await client.prices.create(
      { currency: "mxn", unit_amount: cents, recurring: { interval: "month" }, product },
      { idempotencyKey: `price-move-price-${row.change_id}-${product}-${cents}` },
    );
    await registerSubscriptionPrice(price.id, change.plan as PlanName);
    const schedule = await client.subscriptionSchedules.create(
      { from_subscription: sub.id }, { idempotencyKey: `price-move-schedule-${row.change_id}-${row.restaurant_id}` },
    );
    await client.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        { items: [{ price: item.price.id, quantity: 1 }], start_date: schedule.phases[0].start_date, end_date: boundary },
        { items: [{ price: price.id, quantity: 1 }], start_date: boundary, proration_behavior: "none" },
      ],
    });
    const { error } = await db.from("plan_price_notices")
      .update({ stripe_schedule_id: schedule.id, moves_at: new Date(boundary * 1000).toISOString() })
      .eq("change_id", row.change_id).eq("restaurant_id", row.restaurant_id).is("stripe_schedule_id", null);
    if (error) throw new Error("price move record unavailable");
    return true;
  }, "created_at");
}

interface Change extends PendingItem { id: string; plan: string; new_monthly_price: number }

/**
 * New subscriptions pay the new price from the effective date: the plan's
 * catalogue price changes once, at effective_at. Its configured Stripe Price
 * is cleared so checkout creates one for the new amount (checkoutPrice
 * refuses a configured Price whose amount differs from what the screen shows).
 */
export async function recoverPriceCatalogue(context: RecoveryContext) {
  const { db } = context;
  return runBatch("price catalogue", context, async (limit, offset = 0) => {
    const result = await db.from("plan_price_changes")
      .select("id, created_at, plan, new_monthly_price", { count: "exact" })
      .lte("effective_at", new Date().toISOString()).is("applied_at", null)
      .order("created_at").order("id").range(offset, offset + limit - 1).returns<Change[]>();
    return result as Snapshot<Change>;
  }, async change => {
    const { error } = await db.from("plan_limits")
      .update({ monthly_price: change.new_monthly_price, list_price: change.new_monthly_price, stripe_price_id: null })
      .eq("plan", change.plan);
    if (error) throw new Error("plan catalogue update unavailable");
    const { error: markError } = await db.from("plan_price_changes").update({ applied_at: new Date().toISOString() })
      .eq("id", change.id).is("applied_at", null);
    if (markError) throw new Error("price change record unavailable");
    return true;
  }, "created_at");
}
