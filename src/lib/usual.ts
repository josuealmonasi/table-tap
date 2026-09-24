// ============================================================================
// "Lo de siempre": what this phone usually orders at a restaurant.
//
// Remembered on the phone and nowhere else — per restaurant, in this browser,
// the way the visit card is — so it asks for no account and sends nothing.
// Every order placed from the phone counts each of its lines; a line ordered
// twice or more is a habit, and the menu offers it back.
//
// What is offered is rebuilt from the menu the page loaded, never from what
// was remembered: today's price, and only if the dish, every extra and every
// option chosen are still on it. A line that can no longer be made as it was
// is left out rather than changed — "your usual" with the guacamole quietly
// missing is not your usual. That is this app's one rule: a screen never
// offers what the system would refuse.
//
// Storage can be blocked (private mode, a strict browser) and every access is
// wrapped: a phone that cannot remember is simply never offered it.
// ============================================================================
import type { MenuItem, OrderLineItem } from "@/lib/types";
import { satisfiesRequired } from "@/lib/modifiers";

export interface UsualEntry {
  itemId: string;
  /** Extra ids, sorted: part of what makes it the same line. */
  extras: string[];
  mods: OrderLineItem["mods"];
  notes?: string;
  qty: number;
  /** Orders this line was in. */
  count: number;
  /** When it was last ordered, in ms. */
  last: number;
}

/** A habit, not a one-off: ordered at least this many times. */
export const USUAL_MIN_COUNT = 2;
/** How many lines "lo de siempre" offers. */
export const USUAL_MAX_LINES = 3;
/** How many different lines a phone remembers; the oldest go first. */
const KEEP = 30;

const key = (restaurantId: string) => `tt-usual:${restaurantId}`;

function sameKey(itemId: string, extras: string[], mods: OrderLineItem["mods"], notes?: string): string {
  const sortedMods = Object.keys(mods ?? {})
    .sort()
    .map(k => [k, Array.isArray(mods[k]) ? [...(mods[k] as string[])].sort() : mods[k]]);
  return JSON.stringify([itemId, [...extras].sort(), sortedMods, (notes ?? "").trim()]);
}

export function readUsual(restaurantId: string): UsualEntry[] {
  try {
    const raw = localStorage.getItem(key(restaurantId));
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(value) ? (value as UsualEntry[]).filter(e => e && typeof e.itemId === "string") : [];
  } catch {
    return [];
  }
}

/** Counts an order's lines. Combos are left out: a bundle is a deal, not a habit. */
export function rememberUsual(restaurantId: string, lines: OrderLineItem[], now = Date.now()): void {
  try {
    const entries = readUsual(restaurantId);
    const byKey = new Map(entries.map(e => [sameKey(e.itemId, e.extras, e.mods, e.notes), e]));
    for (const line of lines) {
      if (line.comboId) continue;
      const extras = (line.extras ?? []).map(e => e.id).sort();
      const k = sameKey(line.itemId, extras, line.mods, line.notes);
      const seen = byKey.get(k);
      if (seen) {
        seen.count += 1;
        seen.last = now;
        seen.qty = line.qty;
      } else {
        byKey.set(k, {
          itemId: line.itemId,
          extras,
          mods: line.mods ?? {},
          notes: line.notes?.trim() || undefined,
          qty: line.qty,
          count: 1,
          last: now,
        });
      }
    }
    const kept = [...byKey.values()].sort((a, b) => b.last - a.last).slice(0, KEEP);
    localStorage.setItem(key(restaurantId), JSON.stringify(kept));
  } catch {
    // Not remembered: never offered, which is the honest failure.
  }
}

export function forgetUsual(restaurantId: string): void {
  try {
    localStorage.removeItem(key(restaurantId));
  } catch {
    // Nothing to forget, or nowhere to forget it from.
  }
}

/** Every chosen option still exists on the dish, and the required ones are answered. */
function modsStillValid(item: MenuItem, mods: OrderLineItem["mods"]): boolean {
  for (const [label, value] of Object.entries(mods ?? {})) {
    const group = item.modifiers?.find(m => m.label === label);
    if (!group) return false;
    const picked = Array.isArray(value) ? value : [value];
    if (picked.some(option => !group.options.includes(option))) return false;
  }
  return satisfiesRequired(item.modifiers ?? [], mods);
}

/**
 * The lines to offer, built from the menu the page loaded: the most ordered
 * habits first, at today's prices, and only those that can be made exactly as
 * they were ordered.
 */
export function resolveUsual(
  entries: UsualEntry[],
  items: MenuItem[],
  extras: MenuItem[],
  extrasByProduct: Record<string, string[]>,
): OrderLineItem[] {
  const itemById = new Map(items.map(i => [i.id, i]));
  const extraById = new Map(extras.map(e => [e.id, e]));
  const out: OrderLineItem[] = [];
  const ranked = entries
    .filter(e => e.count >= USUAL_MIN_COUNT)
    .sort((a, b) => b.count - a.count || b.last - a.last);
  for (const entry of ranked) {
    const item = itemById.get(entry.itemId);
    if (!item || !item.available) continue;
    const allowed = new Set(extrasByProduct[item.id] ?? []);
    const chosen = entry.extras.map(id => extraById.get(id));
    if (chosen.some((e, i) => !e || !e.available || !allowed.has(entry.extras[i]))) continue;
    if (!modsStillValid(item, entry.mods)) continue;
    out.push({
      itemId: item.id,
      name: item.name,
      emoji: item.emoji,
      price: item.price,
      discountPct: item.discount_pct ?? 0,
      qty: Math.max(1, Math.floor(entry.qty) || 1),
      mods: entry.mods ?? {},
      extras: (chosen as MenuItem[]).map(e => ({ id: e.id, name: e.name, emoji: e.emoji, price: e.price })),
      notes: entry.notes,
    });
    if (out.length === USUAL_MAX_LINES) break;
  }
  return out;
}
