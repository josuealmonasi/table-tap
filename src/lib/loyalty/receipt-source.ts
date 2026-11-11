import type { createAdminClient } from "@/lib/supabase/admin";
import type { ReceiptOrder } from "@/lib/receipt";
import { receiptCard } from "./attachment-server";

interface LoyaltyOrder extends ReceiptOrder {
  restaurant_id: string;
  paid: boolean;
  loyalty_card_id?: string | null;
  session_id?: string | null;
}

/** Order card takes precedence, then its sitting's card, exactly as the trigger. */
export async function withReceiptCards(db: ReturnType<typeof createAdminClient>, orders: LoyaltyOrder[]): Promise<ReceiptOrder[]> {
  const cache = new Map<string, ReturnType<typeof receiptCard>>();
  return Promise.all(orders.map(async order => {
    if (!order.paid) return order;
    let id = order.loyalty_card_id;
    if (!id && order.session_id) {
      const { data, error } = await db.from("table_sessions").select("loyalty_card_id")
        .eq("restaurant_id", order.restaurant_id).eq("id", order.session_id).maybeSingle();
      if (error) throw new Error("Could not read receipt loyalty sitting");
      id = data?.loyalty_card_id;
    }
    if (!id) return order;
    const key = `${order.restaurant_id}:${id}`;
    if (!cache.has(key)) cache.set(key, receiptCard(order.restaurant_id, id));
    return { ...order, loyalty: await cache.get(key) };
  }));
}
