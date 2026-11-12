import type { createAdminClient } from "@/lib/supabase/admin";
import type { ReceiptOrder } from "@/lib/receipt";
import type { ReceiptCard } from "./attachment";
import { receiptCard } from "./attachment-server";

interface LoyaltyOrder extends ReceiptOrder {
  restaurant_id: string;
  paid: boolean;
  loyalty_card_id?: string | null;
  session_id?: string | null;
}

/**
 * The card each paid order was stamped with. Payment fixes the card onto the
 * order (`fix_loyalty_card_on_payment`), so a reprint names the card that
 * payment stamped even if the table's bill carries another one now, and no
 * sitting is read here (Codex review of #620).
 *
 * The visit card is optional; the receipt is the accounting record. A card
 * that cannot be read is left off the receipt rather than failing the receipt,
 * the reprint, or a till sale that is already paid.
 */
export async function withReceiptCards(_db: ReturnType<typeof createAdminClient>, orders: LoyaltyOrder[]): Promise<ReceiptOrder[]> {
  const cache = new Map<string, Promise<ReceiptCard | null>>();
  return Promise.all(orders.map(async order => {
    const id = order.paid ? order.loyalty_card_id : null;
    if (!id) return order;
    const key = `${order.restaurant_id}:${id}`;
    if (!cache.has(key)) cache.set(key, receiptCard(order.restaurant_id, id).catch(() => null));
    return { ...order, loyalty: await cache.get(key) };
  }));
}
