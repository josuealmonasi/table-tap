import { everyRow, everyRowIn } from "@/lib/paged";
import type { DisputeDb } from "./types";

interface Checkout {
  id: string; restaurant_id: string; order_ids: string[]; stripe_session_id?: string | null;
}
interface Payment { id: string; restaurant_id: string; order_id: string | null }
export interface DisputeOwnership {
  restaurantId: string | null;
  orderIds: string[];
  checkoutId: string | null;
  accountCheckoutId: string | null;
  matched: boolean;
}

/** Only saved checkout/payment provenance can link food. Current Connect settings
 * are a fallback for an unlinked review case, never authority over an old sale. */
export async function disputeOwnership(db: DisputeDb, account: string, live: boolean, intent: string | null, expectedRestaurant?: string): Promise<DisputeOwnership> {
  const checkouts = intent ? await everyRow<Checkout>((a, b) => {
    const query = db.from("diner_checkouts").select("id, restaurant_id, order_ids, stripe_session_id")
      .eq("stripe_payment_intent", intent).eq("stripe_account_id", account).eq("livemode", live);
    return (expectedRestaurant ? query.eq("restaurant_id", expectedRestaurant) : query).order("id").range(a, b);
  }, "dispute checkouts") : [];
  const payments = intent ? await everyRow<Payment>((a, b) => {
    const query = db.from("payments").select("id, restaurant_id, order_id")
      .eq("stripe_payment_intent", intent).eq("stripe_account_id", account);
    return (expectedRestaurant ? query.eq("restaurant_id", expectedRestaurant) : query).order("id").range(a, b);
  }, "dispute payments") : [];
  const tenants = new Set([...checkouts, ...payments].map(row => row.restaurant_id));
  if (tenants.size > 1) throw new Error("Conflicting dispute ownership");
  const restaurantId = [...tenants][0];
  if (restaurantId) {
    const allocations = await everyRowIn<{ order_id: string }>(payments.map(p => p.id), (ids, a, b) => db.from("payment_allocations")
      .select("order_id").eq("restaurant_id", restaurantId).in("payment_id", ids).order("id").range(a, b), "dispute allocations");
    // Account checkouts predate frozen account fields. Match through the saved
    // diner session, which holds account, mode and PaymentIntent together.
    const accounts = await everyRowIn<Checkout>(checkouts.flatMap(c => c.stripe_session_id ? [c.stripe_session_id] : []), (ids, a, b) => db.from("account_checkouts")
      .select("id, restaurant_id, order_ids").eq("restaurant_id", restaurantId).in("stripe_session_id", ids).order("id").range(a, b), "dispute account checkouts");
    return { restaurantId, matched: true, checkoutId: checkouts[0]?.id ?? null, accountCheckoutId: accounts[0]?.id ?? null,
      orderIds: [...new Set([...checkouts.flatMap(c => c.order_ids), ...accounts.flatMap(c => c.order_ids),
        ...payments.flatMap(p => p.order_id ? [p.order_id] : []), ...allocations.map(a => a.order_id)])] };
  }
  const { data, error } = await db.from("restaurants").select("id").eq("stripe_account_id", account).maybeSingle();
  if (error) throw new Error(`Could not attribute dispute account: ${error.message}`);
  return { restaurantId: data?.id ?? null, orderIds: [], matched: false, checkoutId: null, accountCheckoutId: null };
}
