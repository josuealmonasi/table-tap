import { verifyModifiers } from "@/lib/modifiers";
import { capNote } from "@/lib/notes";
import { verifyExtras } from "@/lib/verify-extras";
import type { Combo } from "@/lib/promotions";
import type { CartRejection, VerifiableItem } from "@/lib/verify-cart";
import type { ComboComponent, OrderLineItem } from "@/lib/types";

/** Rebuilds each plate once, then copies its verified extras for money and stock. */
export function verifyCombo(
  combo: Combo,
  line: OrderLineItem,
  qty: number,
  priceMap: Map<string, VerifiableItem>,
  removedExtras: Map<string, string>,
  isOnOpenMenu: (menuId: string | null) => boolean,
): { ok: true; line: OrderLineItem } | { ok: false; rejection: CartRejection } {
  // Extras chosen inside the bundle are charged on top of it, so they get the
  // same treatment as an ordinary line's. Trusting the client here would let
  // a forged payload attach a MX$0 truffle oil to a MX$5 deal.
  const unmatchedParentExtras = [...(line.extras ?? [])];
  const components: ComboComponent[] = [];

  // Required option groups apply per component: a deal containing a steak
  // can't be ordered without its doneness any more than the steak could be
  // on its own. Walk the DB's plates, including ones the client left out.
  for (const component of combo.components) {
    const product = priceMap.get(component.itemId)!;
    const chosen = (line.components ?? []).find(part => part.itemId === component.itemId);
    const result = verifyModifiers(product.modifiers ?? [], chosen?.mods);
    if (!result.ok) {
      return { ok: false, rejection: {
        kind: "missingModifiers", unanswered: result.unanswered.length ? result.unanswered : [product.name],
        forName: product.name, itemId: product.id,
      } };
    }
    const extras = verifyExtras(chosen?.extras, product, priceMap, removedExtras, isOnOpenMenu);
    // The UI copies each upgrade onto the parent. Match one copy at a time:
    // cheese on two plates is two upgrades, while its two views are only one.
    for (const extra of extras) {
      const at = unmatchedParentExtras.findIndex(parent => parent.id === extra.id);
      if (at >= 0) unmatchedParentExtras.splice(at, 1);
    }
    components.push({ ...component, mods: result.mods, ...(extras.length ? { extras } : {}) });
  }
  // Older carts put extras only on the parent. Give those a plate that offers
  // them, so the ticket cannot omit something the diner paid for or put it on
  // the wrong dish. Component-only extras stay on their plate and are included
  // in the flattened charge below.
  for (const extra of unmatchedParentExtras) {
    const plate = components.find(component => priceMap.get(component.itemId)?.item_addons
      ?.some(link => link.addon_id === extra.id));
    if (!plate) {
      removedExtras.set(extra.id, extra.name);
      continue;
    }
    const extras = verifyExtras([extra], priceMap.get(plate.itemId)!, priceMap, removedExtras, isOnOpenMenu);
    if (extras.length) plate.extras = [...(plate.extras ?? []), ...extras];
  }
  const comboExtras = components.flatMap(component => component.extras ?? []);

  return { ok: true, line: {
    itemId: combo.id,
    comboId: combo.id,
    name: combo.name,
    emoji: combo.emoji || "🎁",
    // The bundle price, from the promotion row. Extras sit alongside it and
    // priceCart sums them — the deal fixes what the dishes cost, not what an
    // upgrade costs.
    price: combo.price,
    qty,
    mods: {},
    // Choices are rebuilt from each product's menu definitions; every plate
    // and its structure comes from the DB-built combo.
    components,
    ...(comboExtras.length > 0 ? { extras: comboExtras } : {}),
    notes: capNote(line.notes),
    // A bundle needs no preparation only when NONE of its plates do. One
    // burger in a meal deal is enough to send the whole thing to a cook.
    ...(combo.components.length > 0 &&
      combo.components.every(component => priceMap.get(component.itemId)?.skips_kitchen)
      ? { skipsKitchen: true } : {}),
    // A bundle goes to the bar only when all of it is made there.
    ...(combo.components.length > 0 && combo.components.every(component =>
      priceMap.get(component.itemId)?.categories?.station === "bar") ? { station: "bar" as const } : {}),
  } };
}
