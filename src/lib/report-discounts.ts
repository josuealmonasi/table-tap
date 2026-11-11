import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRow, everyRowIn } from "@/lib/paged";
import { receiptCents } from "@/lib/receipt-amount";

interface DiscountOrder {
  id: string;
  discount: number | null;
  coupon_code: string | null;
  promo_detail: { item?: number; promos?: number; coupon?: number } | null;
}
interface Redemption { order_id: string | null; amount: number }

/** Checkout discounts belong to order acceptance, staff grants to confirmation.
 * Checkout's breakdown is committed with the order. Staff's redemption is
 * committed with its total changes. Neither depends on an activity insert.
 * Never sum the mutable orders.discount for staff grants: it includes checkout
 * savings and a multi-order redemption represents the entire bill only once. */
export async function reportDiscounts(
  db: ReturnType<typeof createAdminClient>, restaurantId: string, currency: string, since: string, until: string,
): Promise<number> {
  const [accepted, legacy, redemptions] = await Promise.all([
    everyRow<DiscountOrder>((a, b) => db.from("orders").select("id, discount, coupon_code, promo_detail")
      .eq("restaurant_id", restaurantId).eq("currency", currency)
      .gte("checkout_discount_at", since).lt("checkout_discount_at", until)
      .order("id").range(a, b), "accepted checkout discounts"),
    everyRow<DiscountOrder>((a, b) => db.from("orders").select("id, discount, coupon_code, promo_detail")
      .eq("restaurant_id", restaurantId).eq("currency", currency).is("checkout_discount_at", null)
      .neq("status", "pending_payment").neq("status", "cancelled")
      .gte("created_at", since).lt("created_at", until).order("id").range(a, b), "legacy checkout discounts"),
    everyRow<Redemption>((a, b) => db.from("coupon_redemptions").select("order_id, amount")
      .eq("restaurant_id", restaurantId).not("confirmed_at", "is", null)
      .gte("confirmed_at", since).lt("confirmed_at", until).order("id").range(a, b), "confirmed discounts"),
  ]);
  const orders = await everyRowIn<DiscountOrder>(redemptions.flatMap(r => r.order_id ? [r.order_id] : []),
    (ids, a, b) => db.from("orders").select("id, discount, coupon_code, promo_detail")
      .eq("restaurant_id", restaurantId).eq("currency", currency).in("id", ids).order("id").range(a, b),
    "discount currency and origin");
  const byId = new Map(orders.map(o => [o.id, o]));
  const initial = [...accepted, ...legacy].reduce((sum, o) => sum + receiptCents(o.promo_detail
    ? Number(o.promo_detail.item ?? 0) + Number(o.promo_detail.promos ?? 0) + Number(o.promo_detail.coupon ?? 0)
    // Older offline sales kept the total discount but no breakdown or coupon.
    : o.coupon_code ? 0 : Number(o.discount ?? 0)), 0);
  const staff = redemptions.reduce((sum, r) => {
    const order = r.order_id ? byId.get(r.order_id) : undefined;
    // A checkout coupon was already counted from its order snapshot above,
    // even if its best-effort redemption insert failed or confirms tomorrow.
    return sum + (order && !Number(order.promo_detail?.coupon ?? 0) ? receiptCents(r.amount) : 0);
  }, 0);
  return (initial + staff) / 100;
}
