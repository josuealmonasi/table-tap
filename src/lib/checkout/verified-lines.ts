import type { createAdminClient } from "@/lib/supabase/admin";
import type { PromotionWithItems } from "@/lib/promotions";
import type { OrderLineItem } from "@/lib/types";
import {
  cartReferences,
  verifyCart,
  type CartRejection,
  type VerifiableItem,
} from "@/lib/verify-cart";

export type VerifiedLines =
  | { ok: true; lines: OrderLineItem[] }
  | { ok: false; rejection: CartRejection }
  /** The dishes could not be read, so nothing can be priced. */
  | { ok: false; rejection: null };

interface VerifiedLinesInput {
  items: OrderLineItem[];
  /** Active promotions for this restaurant, from the DB. */
  promotions: PromotionWithItems[];
  /** Whether a category sits on a menu that is serving right now. */
  onOpenMenu: (categoryId: string | null) => boolean;
  /** Defaults to `MAX_CART_LINES`; the card path has a lower one. */
  maxLines?: number;
}

/**
 * The cart, priced from the database and checked it can still be sold.
 *
 * IMPORTANT: never trust client prices. Every referenced item — products AND
 * extras — plus every combo component is fetched, scoped to the restaurant,
 * because `verifyCart` prices only what it is handed and a missing extra reads
 * to it as one that has vanished. Checkout and the till both come here, so a
 * dish cannot be one price on a phone and another at the counter.
 */
export async function verifiedLines(
  supabase: ReturnType<typeof createAdminClient>,
  restaurantId: string,
  { items, promotions, onOpenMenu, maxLines }: VerifiedLinesInput,
): Promise<VerifiedLines> {
  const refs = cartReferences(items, promotions, maxLines);
  if (!refs.ok) return { ok: false, rejection: refs.rejection };

  const { data: dbItems, error } = await supabase
    .from("menu_items")
    .select("id, name, price, emoji, available, discount_pct, modifiers, category_id, skips_kitchen")
    .in("id", refs.ids)
    .eq("restaurant_id", restaurantId);
  if (error || !dbItems) return { ok: false, rejection: null };

  return verifyCart({
    items,
    promotions,
    dbItems: dbItems as VerifiableItem[],
    isOnOpenMenu: onOpenMenu,
    maxLines,
  });
}
