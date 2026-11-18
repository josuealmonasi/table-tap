import { runBatch, type PendingItem, type RecoveryContext, type Snapshot } from "./job";

interface Change extends PendingItem { id: string; plan: string }

/**
 * Who a scheduled price change must notify, read from Stripe as well as from
 * `restaurants.plan`. Scheduling queues the restaurants whose local plan is
 * the tier; a subscriber Stripe already bills on that tier, whose sync has not
 * landed yet, was missed and would have been moved to the new price without
 * a notice (review 1117b, finding 4). Every run, each pending change gets a
 * notice row for every live subscription whose Price maps to its plan, except
 * founders. Adding twice is a no-op; a late addition still gets its full 30
 * days, because the move counts from when THAT notice is sent.
 */
export async function recoverPriceRecipients(context: RecoveryContext) {
  const { db, client } = context;
  return runBatch("price recipients", context, async (limit, offset = 0) => {
    const result = await db.from("plan_price_changes")
      .select("id, created_at, plan", { count: "exact" }).is("applied_at", null)
      .order("created_at").order("id").range(offset, offset + limit - 1).returns<Change[]>();
    return result as Snapshot<Change>;
  }, async change => {
    const { data: prices, error: priceError } = await db.from("restaurant_subscription_prices").select("price_id").eq("plan", change.plan);
    if (priceError) throw new Error("price registry unavailable");
    const onPlan = new Set((prices ?? []).map(p => p.price_id as string));
    const restaurants = new Set<string>();
    for (const status of ["active", "trialing", "past_due"] as const) {
      // Paged here rather than through billing-state, which builds the Stripe
      // client at import: the recovery route must not need a key to load.
      const subs = [];
      for (let after: string | undefined, more = true; more;) {
        const page = await client.subscriptions.list({ status, limit: 100, ...(after ? { starting_after: after } : {}) });
        subs.push(...page.data);
        more = page.has_more;
        after = page.data.at(-1)?.id;
        if (more && !after) throw new Error("subscription page has no continuation");
      }
      for (const sub of subs) {
        const price = sub.items.data.length === 1 ? sub.items.data[0].price.id : null;
        const restaurant = sub.metadata?.restaurant_id;
        if (price && restaurant && onPlan.has(price)) restaurants.add(restaurant);
      }
    }
    if (!restaurants.size) return true;
    const { data: eligible, error: readError } = await db.from("restaurants")
      .select("id").in("id", [...restaurants]).is("founding_number", null);
    if (readError) throw new Error("recipient lookup unavailable");
    const rows = (eligible ?? []).map(r => ({ change_id: change.id, restaurant_id: r.id as string }));
    if (!rows.length) return true;
    const { error } = await db.from("plan_price_notices").upsert(rows, { onConflict: "change_id,restaurant_id", ignoreDuplicates: true });
    if (error) throw new Error("recipient queue unavailable");
    return true;
  }, "created_at");
}
