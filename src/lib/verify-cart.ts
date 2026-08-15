import { buildCombos } from "@/lib/promotions";
import { MAX_LINE_QTY } from "@/lib/pricing";
import { capNote } from "@/lib/notes";
import { missingRequired } from "@/lib/modifiers";
import type { PromotionWithItems } from "@/lib/promotions";
import type { MenuItem, Modifier, OrderExtra, OrderLineItem } from "@/lib/types";

/**
 * How many of this dish the line really orders.
 *
 * The stored line and the price have to agree: capping only the money left a
 * ticket reading "100000×" against a bill for ninety-nine.
 */
function clampQty(qty: number): number {
  return Math.min(MAX_LINE_QTY, Math.max(1, Math.floor(qty)));
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
}

/** Why a cart can't be charged, as data — the caller supplies the wording. */
export type CartRejection =
  /** A dish (or a bundle) has gone off the menu since it was added. */
  | { kind: "unavailable"; name: string; itemId: string }
  /** A required option group was never answered. */
  | { kind: "missingModifiers"; unanswered: string[]; forName: string; itemId: string }
  /** Extras vanished; the customer is asked to confirm before paying. */
  | { kind: "removedExtras"; ids: string[]; names: string[] };

export interface VerifyCartInput {
  /** The client's cart, trusted only for *what* was asked for. */
  items: OrderLineItem[];
  /** Active promotions for this restaurant, from the DB. */
  promotions: PromotionWithItems[];
  /** Every referenced product and extra, fetched scoped to the restaurant. */
  dbItems: VerifiableItem[];
  /** Whether a category sits on a menu that is serving right now. */
  isOnOpenMenu: (categoryId: string | null) => boolean;
}

export type VerifyCartResult =
  | { ok: true; lines: OrderLineItem[] }
  | { ok: false; rejection: CartRejection };

/** Re-prices an extra from the DB, or reports it as gone. */
function verifyExtras(
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

export function verifyCart(input: VerifyCartInput): VerifyCartResult {
  const { items, promotions, dbItems, isOnOpenMenu } = input;
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
      if (!part || !part.available || !isOnOpenMenu(part.category_id)) {
        return { ok: false, rejection: gone(line) };
      }
    }

    // Extras chosen inside the bundle are charged on top of it, so they get the
    // same treatment as an ordinary line's. Trusting the client here would let
    // a forged payload attach a MX$0 truffle oil to a MX$5 deal.
    const comboExtras = verifyExtras(line.extras, priceMap, removedExtras);

    // Required option groups apply per component: a deal containing a steak
    // can't be ordered without its doneness any more than the steak could be
    // on its own.
    for (const component of line.components ?? []) {
      const product = priceMap.get(component.itemId);
      if (!product) continue;
      const unanswered = missingRequired(product.modifiers ?? [], component.mods);
      if (unanswered.length > 0) {
        return {
          ok: false,
          rejection: {
            kind: "missingModifiers",
            unanswered,
            forName: component.name,
            itemId: component.itemId,
          },
        };
      }
    }

    lines.push({
      itemId: combo.id,
      comboId: combo.id,
      name: combo.name,
      emoji: combo.emoji || "🎁",
      // The bundle price, from the promotion row. Extras sit alongside it and
      // priceCart sums them — the deal fixes what the dishes cost, not what an
      // upgrade costs.
      price: combo.price,
      qty: clampQty(line.qty),
      mods: {},
      // The client's per-component choices are kept for the kitchen ticket
      // (they're instructions, not money), but every component and its
      // structure comes from the DB-built combo.
      components: combo.components.map(c => {
        const chosen = (line.components ?? []).find(x => x.itemId === c.itemId);
        return chosen ? { ...c, mods: chosen.mods, extras: chosen.extras } : c;
      }),
      ...(comboExtras.length > 0 ? { extras: comboExtras } : {}),
      notes: capNote(line.notes),
    });
  }

  for (const line of plainLines) {
    const db = priceMap.get(line.itemId);
    if (!db || !db.available || !isOnOpenMenu(db.category_id)) {
      return { ok: false, rejection: gone(line, db?.name) };
    }

    const verifiedExtras = verifyExtras(line.extras, priceMap, removedExtras);

    // Checked against the DB's modifiers rather than the client's. The customer
    // screen already disables "Add to cart" for this, but that copy can be
    // stale (a tab left open while the manager marked a group required) or
    // simply absent, so this is the one that decides — otherwise the kitchen
    // gets a ticket it can't cook from.
    const unanswered = missingRequired(db.modifiers ?? [], line.mods);
    if (unanswered.length > 0) {
      return {
        ok: false,
        rejection: {
          kind: "missingModifiers",
          unanswered,
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
      mods: line.mods ?? {},
      extras: verifiedExtras.length ? verifiedExtras : undefined,
      notes: capNote(line.notes),
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
  return { kind: "unavailable", name: dbName ?? line.name ?? "", itemId: line.itemId };
}
