import type { Modifier, OrderLineItem } from "@/lib/types";

/**
 * Which required option groups a line hasn't answered.
 *
 * Pure and shared, because this rule is enforced in two places and they must
 * agree: the customer screen disables "Add to cart" with it, and /api/checkout
 * re-runs it against the product's modifiers as stored in the DB. The client
 * copy is a courtesy — a line can reach checkout from a stale tab or a
 * hand-rolled request, so the server is the one that decides.
 *
 * A group counts as answered when it holds a non-empty choice. "single" stores
 * a string, "multi" an array, and an empty array is the same as never having
 * picked anything.
 */
export function missingRequired(
  modifiers: Modifier[],
  mods: OrderLineItem["mods"] | undefined,
): string[] {
  const chosen = mods ?? {};
  return modifiers
    .filter(group => group.required)
    .filter(group => {
      const value = chosen[group.label];
      if (Array.isArray(value)) return value.length === 0;
      return typeof value !== "string" || value.trim() === "";
    })
    .map(group => group.label);
}

/** True when every required group on the product has a choice. */
export function satisfiesRequired(
  modifiers: Modifier[],
  mods: OrderLineItem["mods"] | undefined,
): boolean {
  return missingRequired(modifiers, mods).length === 0;
}
