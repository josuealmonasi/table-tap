import type { ComboComponent, MenuItem } from "@/lib/types";
import type { CartPromo } from "@/lib/pricing";

// Shapes and helpers for promotions (combo bundles and quantity deals). The
// row shape is shared by the dashboard editor, the customer menu and checkout
// so all three agree on what a promotion means.

export type PromotionKind = "combo" | "bogo" | "tiered";

export interface PromotionRow {
  id: string;
  restaurant_id: string;
  kind: PromotionKind;
  name: string;
  emoji: string;
  description: string | null;
  combo_price: number | null;
  buy_qty: number | null;
  pay_qty: number | null;
  tiers: { qty: number; price: number }[] | null;
  active: boolean;
  sort_order: number;
}

/** A promotion plus the items it covers (`qty` = how many the combo includes). */
export interface PromotionWithItems extends PromotionRow {
  items: { item_id: string; qty: number }[];
}

/** A combo as the customer menu renders it. */
export interface Combo {
  id: string;
  name: string;
  emoji: string;
  description: string | null;
  /** What the bundle costs. */
  price: number;
  /** What the components would cost separately — for the "save X" line. */
  regularPrice: number;
  components: ComboComponent[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Turns combo promotions into menu cards, using live item prices. A combo is
 * dropped entirely when any component is missing or unavailable — better no
 * card than one that fails at checkout.
 */
export function buildCombos(
  promos: PromotionWithItems[],
  itemsById: Map<string, MenuItem>,
): Combo[] {
  const combos: Combo[] = [];

  for (const promo of promos) {
    if (promo.kind !== "combo" || !promo.active || promo.combo_price == null) continue;
    if (promo.items.length === 0) continue;

    const components: ComboComponent[] = [];
    let regularPrice = 0;
    let complete = true;

    for (const { item_id, qty } of promo.items) {
      const item = itemsById.get(item_id);
      if (!item || !item.available) {
        complete = false;
        break;
      }
      const n = Math.max(1, Math.floor(qty));
      components.push({ itemId: item.id, name: item.name, emoji: item.emoji, qty: n });
      regularPrice += Number(item.price) * n;
    }
    if (!complete) continue;

    combos.push({
      id: promo.id,
      name: promo.name,
      emoji: promo.emoji,
      description: promo.description,
      price: Number(promo.combo_price),
      regularPrice: round2(regularPrice),
      components,
    });
  }

  return combos;
}

/**
 * The quantity deals (bogo/tiered) in a form the pricing engine understands.
 * Combos are left out — they're priced as their own cart line.
 */
export function toCartPromos(promos: PromotionWithItems[]): CartPromo[] {
  return promos
    .filter(p => p.active && (p.kind === "bogo" || p.kind === "tiered"))
    .map(p => ({
      id: p.id,
      name: p.name,
      kind: p.kind as "bogo" | "tiered",
      buyQty: p.buy_qty,
      payQty: p.pay_qty,
      tiers: p.tiers,
      itemIds: p.items.map(i => i.item_id),
    }));
}
