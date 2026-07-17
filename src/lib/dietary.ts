/** Dietary / allergen tags a product can carry. Keys are stored in
 *  menu_items.dietary; the label + emoji are shown to customers and in the
 *  product editor. Shared so both sides stay in sync. */
export interface DietaryTag {
  key: string;
  label: string;
  emoji: string;
}

export const DIETARY_TAGS: DietaryTag[] = [
  { key: "vegetarian", label: "Vegetarian", emoji: "🥗" },
  { key: "vegan", label: "Vegan", emoji: "🌱" },
  { key: "gluten_free", label: "Gluten-free", emoji: "🌾" },
  { key: "dairy_free", label: "Dairy-free", emoji: "🥛" },
  { key: "nut_free", label: "Nut-free", emoji: "🥜" },
  { key: "halal", label: "Halal", emoji: "☪️" },
  { key: "spicy", label: "Spicy", emoji: "🌶️" },
  { key: "seafood", label: "Contains seafood", emoji: "🦐" },
];

const BY_KEY = new Map(DIETARY_TAGS.map(t => [t.key, t]));

/** Resolve stored keys to their tag definitions (unknown keys are dropped). */
export function dietaryTags(keys: string[] | null | undefined): DietaryTag[] {
  return (keys ?? []).map(k => BY_KEY.get(k)).filter((t): t is DietaryTag => Boolean(t));
}
