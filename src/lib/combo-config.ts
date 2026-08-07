import type { ComboComponent, MenuItem, OrderExtra, OrderLineItem } from "@/lib/types";
import { missingRequired } from "@/lib/modifiers";
import type { Combo } from "@/lib/promotions";

/** One component of a bundle, with whatever the diner has chosen for it. */
export interface ComponentChoice {
  itemId: string;
  mods: Record<string, string | string[]>;
  extraIds: string[];
}

/**
 * Every extra chosen across a bundle, flattened.
 *
 * The pricing engine sums a line's own `extras`, and a combo is one line, so
 * this is what makes an oat-milk upgrade actually cost money: the bundle price
 * covers the dishes, extras are charged on top of it. Duplicates are kept —
 * two coffees each taking oat milk is two charges, not one.
 */
export function comboExtras(
  choices: ComponentChoice[],
  extrasById: Map<string, MenuItem>,
): OrderExtra[] {
  const out: OrderExtra[] = [];
  for (const choice of choices) {
    for (const id of choice.extraIds) {
      const extra = extrasById.get(id);
      if (!extra) continue;
      out.push({ id: extra.id, name: extra.name, emoji: extra.emoji, price: extra.price });
    }
  }
  return out;
}

/**
 * Folds the diner's choices back into the bundle's components, so the kitchen
 * ticket says which plate each instruction belongs to.
 */
export function applyChoices(
  components: ComboComponent[],
  choices: ComponentChoice[],
  extrasById: Map<string, MenuItem>,
): ComboComponent[] {
  return components.map(component => {
    const choice = choices.find(c => c.itemId === component.itemId);
    if (!choice) return component;
    const extras = comboExtras([choice], extrasById);
    return {
      ...component,
      ...(Object.keys(choice.mods).length > 0 ? { mods: choice.mods } : {}),
      ...(extras.length > 0 ? { extras } : {}),
    };
  });
}

/**
 * Which components still need a required choice before the bundle can be added.
 *
 * Required option groups apply per component: a deal containing a steak can't
 * be ordered without its doneness any more than the steak could on its own.
 * Returns component names so the customer is told which plate to look at.
 */
export function comboMissingRequired(
  components: ComboComponent[],
  choices: ComponentChoice[],
  itemsById: Map<string, MenuItem>,
): string[] {
  const out: string[] = [];
  for (const component of components) {
    const product = itemsById.get(component.itemId);
    if (!product) continue;
    const choice = choices.find(c => c.itemId === component.itemId);
    const missing = missingRequired(product.modifiers ?? [], choice?.mods ?? {});
    if (missing.length > 0) out.push(`${component.name} (${missing.join(", ")})`);
  }
  return out;
}

/** Builds the cart line for a configured bundle. */
export function comboCartLine(
  combo: Combo,
  choices: ComponentChoice[],
  extrasById: Map<string, MenuItem>,
): OrderLineItem {
  const extras = comboExtras(choices, extrasById);
  return {
    itemId: combo.id,
    comboId: combo.id,
    name: combo.name,
    emoji: combo.emoji || "🎁",
    // The bundle price. Extras ride alongside and are summed by priceCart, so
    // this stays exactly what the menu advertised.
    price: combo.price,
    qty: 1,
    mods: {},
    components: applyChoices(combo.components, choices, extrasById),
    ...(extras.length > 0 ? { extras } : {}),
  };
}
