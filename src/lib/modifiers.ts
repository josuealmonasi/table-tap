import type { Modifier, OrderLineItem } from "@/lib/types";

/** Rebuild choices from the menu; a JSON object is never a kitchen instruction. */
export function verifyModifiers(modifiers: Modifier[], requested: unknown):
  | { ok: true; mods: OrderLineItem["mods"] }
  | { ok: false; unanswered: string[] } {
  const input = requested ?? {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, unanswered: modifiers.map(group => group.label) };
  }
  const choices = input as Record<string, unknown>;
  // Only the menu's own groups are read, so a key it does not have is simply
  // left out. Refused instead, a group the manager deleted while a diner's tab
  // was open asked them to "choose" something no longer on the menu, and the
  // cart could not be paid until the dish was taken out and added again.
  const unanswered: string[] = [];
  const entries: [string, string | string[]][] = [];
  for (const group of modifiers) {
    if (!Object.prototype.hasOwnProperty.call(choices, group.label)) continue;
    const choice = choices[group.label];
    if (group.type === "single" && typeof choice === "string" && group.options.includes(choice)) {
      entries.push([group.label, choice]);
    } else if (group.type === "multi" && Array.isArray(choice) &&
      choice.every(value => typeof value === "string" && group.options.includes(value))) {
      entries.push([group.label, [...new Set<string>(choice)]]);
    } else {
      unanswered.push(group.label);
    }
  }
  // fromEntries also treats a menu label called __proto__ as an ordinary key.
  const mods = Object.fromEntries(entries);
  unanswered.push(...missingRequired(modifiers, mods));
  return unanswered.length ? { ok: false, unanswered: [...new Set(unanswered)] } : { ok: true, mods };
}

/** Old order snapshots can predate verification: never coerce their JSON to text. */
export function modifierEntries(mods: unknown): [string, string][] {
  if (!mods || typeof mods !== "object" || Array.isArray(mods)) return [];
  return Object.entries(mods).flatMap(([group, value]) => {
    const text = typeof value === "string" ? value : Array.isArray(value)
      ? value.filter((choice): choice is string => typeof choice === "string").join(", ")
      : "";
    return text ? [[group, text] as [string, string]] : [];
  });
}

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
