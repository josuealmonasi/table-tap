import type { VerifiableItem } from "@/lib/verify-cart";
import type { OrderExtra } from "@/lib/types";

/** Re-prices an extra from the DB, or reports it as gone. */
export function verifyExtras(
  requested: OrderExtra[] | undefined,
  priceMap: Map<string, VerifiableItem>,
  removed: Map<string, string>,
): OrderExtra[] {
  const kept: OrderExtra[] = [];
  for (const extra of requested ?? []) {
    const db = priceMap.get(extra.id);
    if (!db || !db.available) {
      removed.set(extra.id, extra.name);
      continue;
    }
    kept.push({ id: db.id, name: db.name, emoji: db.emoji, price: db.price });
  }
  return kept;
}
