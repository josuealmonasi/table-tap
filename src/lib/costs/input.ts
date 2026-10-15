import { round2 } from "@/lib/money";

/**
 * How what an owner types about their ingredients is read.
 *
 * An ingredient is used in g, ml or pieces. It is bought by the kilo, the
 * litre or the box, so a pack may be typed in kg or l and is stored in the
 * small unit: a 1 kg bag is 1000 g, and a recipe says 18 g.
 *
 * Pure.
 */

export type IngredientUnit = "g" | "ml" | "pza";
export const INGREDIENT_UNITS: IngredientUnit[] = ["g", "ml", "pza"];

/** How a pack's size may be typed. */
export type PackUnit = "g" | "kg" | "ml" | "l" | "pza";

/** The units a pack of this ingredient may be typed in. */
export function packUnitsFor(unit: IngredientUnit): PackUnit[] {
  return unit === "g" ? ["kg", "g"] : unit === "ml" ? ["l", "ml"] : ["pza"];
}

/** Enough for any café's pantry; a list longer than this is a script, not a kitchen. */
export const MAX_INGREDIENTS = 500;
/** Lines in one product's recipe. */
export const MAX_RECIPE_LINES = 40;
export const MAX_PACK_SIZE = 1_000_000;
export const MAX_PACK_PRICE = 1_000_000;
export const MAX_RECIPE_QUANTITY = 100_000;
export const MAX_TERMINAL_FEE_PCT = 15;

/**
 * A positive or zero decimal as people type it: "1,250.50", "0.5", "18".
 * At most `decimals` places, at most `max`. Null when it is not one.
 */
export function decimal(raw: unknown, max: number, decimals: number): number | null {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(/,/g, "") : "";
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value <= max ? value : null;
}

/** An ingredient's name: trimmed, 1–80 characters. */
export function ingredientName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 80 ? name : null;
}

/** Who sells it: trimmed, at most 80 characters, or nothing. "bad" when it is not text. */
export function supplierName(raw: unknown): string | null | "bad" {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return "bad";
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length > 80) return "bad";
  return name || null;
}

export function ingredientUnit(raw: unknown): IngredientUnit | null {
  return INGREDIENT_UNITS.includes(raw as IngredientUnit) ? (raw as IngredientUnit) : null;
}

/**
 * A pack's size in the ingredient's own unit: 1 kg is 1000 g. Null when the
 * size is not a number, or the unit is not one this ingredient comes in.
 */
export function packSize(raw: unknown, packUnit: unknown, unit: IngredientUnit): number | null {
  if (!packUnitsFor(unit).includes(packUnit as PackUnit)) return null;
  const size = decimal(raw, MAX_PACK_SIZE, 3);
  if (size === null || size <= 0) return null;
  const inBase = packUnit === "kg" || packUnit === "l" ? size * 1000 : size;
  return inBase <= MAX_PACK_SIZE ? Math.round(inBase * 1000) / 1000 : null;
}

/** What a pack costs, in money: two decimals. */
export function packPrice(raw: unknown): number | null {
  const price = decimal(raw, MAX_PACK_PRICE, 2);
  return price === null ? null : round2(price);
}

/** How much of an ingredient one product takes: more than nothing, three decimals. */
export function recipeQuantity(raw: unknown): number | null {
  const quantity = decimal(raw, MAX_RECIPE_QUANTITY, 3);
  return quantity !== null && quantity > 0 ? quantity : null;
}

/** A terminal's fee as a percentage of the sale, 0–15. */
export function terminalFeePct(raw: unknown): number | null {
  const pct = decimal(raw, MAX_TERMINAL_FEE_PCT, 2);
  return pct === null ? null : round2(pct);
}

/**
 * A pack shown the way it was probably bought: 1000 g reads "1 kg". Only
 * whole thousands are folded, so 250 g stays 250 g.
 */
export function packLabel(size: number, unit: IngredientUnit): { size: number; unit: PackUnit } {
  if (unit !== "pza" && size >= 1000 && size % 1000 === 0) return { size: size / 1000, unit: unit === "g" ? "kg" : "l" };
  return { size, unit };
}
