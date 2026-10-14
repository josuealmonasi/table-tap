import type { OrderLineItem } from "@/lib/types";
import type { RememberedLine } from "@/lib/usual";
import { remember } from "@/lib/pos-quick";

/**
 * The sale this till rang last, kept on this device so "Repetir último
 * pedido" can ring it again — the regular who orders the same thing every
 * morning. What was chosen, by id; never what it cost then.
 */
const key = (restaurantId: string) => `tt-pos-last:${restaurantId}`;

export function rememberLastSale(restaurantId: string, lines: OrderLineItem[]): void {
  try {
    const kept = remember(lines);
    if (kept.length) localStorage.setItem(key(restaurantId), JSON.stringify(kept));
  } catch {
    // A browser that will not store it simply has nothing to repeat.
  }
}

export function readLastSale(restaurantId: string): RememberedLine[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(restaurantId)) ?? "[]");
    return Array.isArray(parsed) ? (parsed as RememberedLine[]) : [];
  } catch {
    return [];
  }
}
