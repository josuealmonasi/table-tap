/** Ingredient id to quantity, in the ingredient's own unit. */
export type Usage = Map<string, number>;

export type WasteReason = "spoiled" | "unsold" | "mistake" | "staff" | "returned";
export const WASTE_REASONS: WasteReason[] = ["spoiled", "unsold", "mistake", "staff", "returned"];
/** A plate a customer sent back: a loss to report, but its food left with the sale. */
export const PRODUCT_ONLY_REASONS: WasteReason[] = ["returned"];

export interface WasteEntry {
  id: string;
  ingredient_id: string | null;
  item_id: string | null;
  name: string;
  quantity: number;
  reason: WasteReason;
  note: string | null;
  cost: number | null;
  recorded_by: string;
  created_at: string;
}
