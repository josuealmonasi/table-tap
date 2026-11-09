import { buildCombos } from "@/lib/promotions";
import { MAX_LINE_QTY } from "@/lib/pricing";
import { capDishName, capNote } from "@/lib/notes";
import { verifyModifiers } from "@/lib/modifiers";
import { verifyExtras } from "@/lib/verify-extras";
import { verifyCombo } from "@/lib/verify-combo";
import type { PromotionWithItems } from "@/lib/promotions";
import type { MenuItem, Modifier, OrderLineItem } from "@/lib/types";
import { MAX_CART_LINES, type CartRejection } from "@/lib/cart-limits";

// Kept importable from here, where the routes that check a cart find them.
export { MAX_CART_LINES, MAX_CART_REFS, type CartRejection } from "@/lib/cart-limits";
export { cartReferences, referencedItemIds } from "@/lib/cart-references";

/**
 * How many of this dish the line really orders.
 *
 * The stored line and the price have to agree: capping only the money left a
 * ticket reading "100000×" against a bill for ninety-nine.
 */
function clampQty(qty: number): number {
  // NaN survives both clamps: `Math.max(1, NaN)` is NaN, and so is the `min`.
  // A quantity of "abc" therefore reached the insert as NaN and came back as a
  // 500 from Postgres — an unhandled crash on the route that takes money,
  // rather than a refusal. One line of the cart is not a number; the honest
  // reading of that is one.
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_LINE_QTY, Math.max(1, n));
}

/**
 * Rebuilds a submitted cart from database truth.
 *
 * This is the rule that makes the checkout honest: a price, a discount, a
 * combo's contents and whether a dish is even orderable all come from the
 * rows fetched here, never from the request. A forged payload can change what
 * is asked for, but not what it costs.
 *
 * Pure — the caller does the fetching and turns a rejection into a response.
 * It lived inside the checkout route, where the only way to exercise it was a
 * full HTTP round trip against Stripe, so the rules that protect the money
 * were the least-tested code in the app.
 */
/** The `menu_items` columns the verification actually reads. */
export interface VerifiableItem {
  id: string;
  name: string;
  price: number;
  emoji: string;
  available: boolean;
  discount_pct: number | string | null;
  modifiers: Modifier[] | null;
  category_id: string | null;
  menu_id: string | null;
  is_addon: boolean;
  /** Only the extras this product offers, from its saved links. */
  item_addons: { addon_id: string }[];
  /** Needs no preparation. Absent on rows fetched before this existed. */
  skips_kitchen?: boolean | null;
  /** Its section, embedded: where the dish is made. Absent = the kitchen. */
  categories?: { station?: string | null } | null;
}

/** Where a dish is made, from its section: the bar, or (by default) the kitchen. */
const madeAtBar = (item: VerifiableItem | undefined): boolean => item?.categories?.station === "bar";

export interface VerifyCartInput {
  /** The client's cart, trusted only for *what* was asked for. */
  items: OrderLineItem[];
  /** Active promotions for this restaurant, from the DB. */
  promotions: PromotionWithItems[];
  /** Every referenced product and extra, fetched scoped to the restaurant. */
  dbItems: VerifiableItem[];
  /** Whether the item's own menu is serving right now. */
  isOnOpenMenu: (menuId: string | null) => boolean;
  /** Defaults to `MAX_CART_LINES`; the card path has a lower one. */
  maxLines?: number;
}

export type VerifyCartResult =
  { ok: true; lines: OrderLineItem[] } | { ok: false; rejection: CartRejection };

export function verifyCart(input: VerifyCartInput): VerifyCartResult {
  const { items, promotions, dbItems, isOnOpenMenu } = input;

  // Before anything is priced or looked up: the work below is per line, and
  // the point of the cap is not to do it ten thousand times.
  const maxLines = input.maxLines ?? MAX_CART_LINES;
  if (items.length > maxLines) {
    return { ok: false, rejection: { kind: "tooManyLines", limit: maxLines } };
  }
  const priceMap = new Map(dbItems.map(d => [d.id, d]));
  const lines: OrderLineItem[] = [];
  const removedExtras = new Map<string, string>();

  const comboLines = items.filter(i => i.comboId);
  const plainLines = items.filter(i => !i.comboId);

  const combosById = new Map(
    buildCombos(
      promotions,
      new Map(dbItems.map(d => [d.id, d as unknown as MenuItem])),
    ).map(c => [c.id, c]),
  );

  for (const line of comboLines) {
    const combo = combosById.get(line.comboId!);
    if (!combo) {
      return { ok: false, rejection: gone(line) };
    }

    // A bundle is only orderable while every component is. buildCombos already
    // hides a combo whose components have gone, but a cart left open through
    // closing time would otherwise still reach here.
    for (const component of combo.components) {
      const part = priceMap.get(component.itemId);
      if (!part || !part.available || !isOnOpenMenu(part.menu_id)) {
        return { ok: false, rejection: gone(line) };
      }
    }

    const result = verifyCombo(combo, line, clampQty(line.qty), priceMap, removedExtras, isOnOpenMenu);
    if (!result.ok) return result;
    lines.push(result.line);
  }

  for (const line of plainLines) {
    const db = priceMap.get(line.itemId);
    if (!db || !db.available || !isOnOpenMenu(db.menu_id)) {
      return { ok: false, rejection: gone(line, db?.name) };
    }

    const verifiedExtras = verifyExtras(line.extras, db, priceMap, removedExtras, isOnOpenMenu);

    // Checked against the DB's modifiers rather than the client's. The customer
    // screen already disables "Add to cart" for this, but that copy can be
    // stale (a tab left open while the manager marked a group required) or
    // simply absent, so this is the one that decides — otherwise the kitchen
    // gets a ticket it can't cook from.
    const choices = verifyModifiers(db.modifiers ?? [], line.mods);
    if (!choices.ok) {
      return {
        ok: false,
        rejection: {
          kind: "missingModifiers",
          unanswered: choices.unanswered.length ? choices.unanswered : [db.name],
          forName: db.name,
          itemId: db.id,
        },
      };
    }

    lines.push({
      itemId: db.id,
      name: db.name,
      emoji: db.emoji,
      price: db.price,
      // From the DB, never the client — a forged discount would otherwise let
      // a customer set their own price.
      discountPct: Number(db.discount_pct) || 0,
      qty: clampQty(line.qty),
      mods: choices.mods,
      extras: verifiedExtras.length ? verifiedExtras : undefined,
      notes: capNote(line.notes),
      // From the DB, like the name and the price: the ticket has to say what
      // was true when the order was placed, not what the menu says today.
      ...(db.skips_kitchen ? { skipsKitchen: true } : {}),
      // Where it is made, from its section at the time — the same reason.
      ...(madeAtBar(db) ? { station: "bar" as const } : {}),
    });
  }

  // If any extras dropped out, don't charge yet — let the customer see what
  // changed and confirm. The client removes them and re-submits.
  if (removedExtras.size > 0) {
    return {
      ok: false,
      rejection: {
        kind: "removedExtras",
        ids: [...removedExtras.keys()],
        names: [...removedExtras.values()],
      },
    };
  }

  return { ok: true, lines };
}

/**
 * The dish is off the menu, or was never on this one.
 *
 * The name is the kitchen's if we can still find the dish, the cart's if not,
 * and empty when neither knows — a request carrying only an id used to produce
 * "undefined is no longer available." for the diner to read.
 */
function gone(line: OrderLineItem, dbName?: string): CartRejection {
  return {
    kind: "unavailable",
    name: dbName ?? capDishName(line.name),
    itemId: line.itemId,
  };
}
