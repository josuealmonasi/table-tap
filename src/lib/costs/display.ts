import type { IngredientUnit } from "./input";

/**
 * Ingredient costs the way an owner reads a price list.
 *
 * A gram of coffee costs MX$0.38 and a millilitre of milk MX$0.025 — both
 * true, and both round to nonsense at two decimals. Prices are shown per
 * kilo, per litre or per piece, which is how the supplier quotes them.
 *
 * Pure.
 */

export type ShownUnit = "kg" | "l" | "pza";

export function perShownUnit(unitCost: number, unit: IngredientUnit): { amount: number; unit: ShownUnit } {
  if (unit === "g") return { amount: unitCost * 1000, unit: "kg" };
  if (unit === "ml") return { amount: unitCost * 1000, unit: "l" };
  return { amount: unitCost, unit: "pza" };
}

/** A share as people say it: 0.312 is "31%"; under ten keeps a decimal, "3.1%". */
export function percent(share: number): string {
  const pct = share * 100;
  const shown = Math.abs(pct) < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
  return `${shown}%`;
}

/** A change as a signed share of where it started: +20%. */
export function change(before: number, after: number): string {
  if (before <= 0) return "";
  const share = (after - before) / before;
  return `${share >= 0 ? "+" : "−"}${percent(Math.abs(share))}`;
}

/** An amount of an ingredient, without a run of zeros: 18, 0.5, 1.25. */
export function amount(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
