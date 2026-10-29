import { verifyModifiers } from "@/lib/modifiers";
import type { VerifiableItem } from "@/lib/verify-cart";
import type { OrderExtra } from "@/lib/types";

/** Re-prices an offered extra from the DB, or reports it as gone. */
export function verifyExtras(
  requested: OrderExtra[] | undefined,
  parent: VerifiableItem,
  priceMap: Map<string, VerifiableItem>,
  removed: Map<string, string>,
  isOnOpenMenu: (menuId: string | null) => boolean,
): OrderExtra[] {
  const kept: OrderExtra[] = [];
  for (const extra of requested ?? []) {
    const db = priceMap.get(extra.id);
    // Extras carry no choices. A dish needing an answer cannot ride along
    // as an extra and leave the kitchen guessing how to make it.
    if (!db || !db.available || !db.is_addon || !isOnOpenMenu(db.menu_id) ||
      !parent.item_addons?.some(link => link.addon_id === db.id) ||
      !verifyModifiers(db.modifiers ?? [], {}).ok) {
      removed.set(extra.id, extra.name);
      continue;
    }
    kept.push({ id: db.id, name: db.name, emoji: db.emoji, price: db.price });
  }
  return kept;
}
