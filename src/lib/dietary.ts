/**
 * Dietary and allergen tags.
 *
 * The list belongs to the restaurant: it lives in `dietary_tags` and they build
 * it. These eight are only the starting point — the same ones the database
 * seeds — and stay here for two reasons: to translate the built-ins by `key`,
 * and so a screen that has not loaded its own yet shows something sensible.
 *
 * What a dish stores is the `key`, never the label. Renaming a tag does not
 * detach it from the dishes already carrying it.
 */
export interface DietaryTag {
  key: string;
  label: string;
  /** Restaurant-authored only; the built-ins are translated by `key`. */
  labelEn?: string | null;
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

/** The ones with a translation of their own in `i18n.dietary`. */
const BUILT_IN = new Set(DIETARY_TAGS.map(t => t.key));

export const isBuiltIn = (key: string): boolean => BUILT_IN.has(key);

/** What the database hands back, as-is. */
export interface StoredDietaryTag {
  id: string;
  key: string;
  label: string;
  label_en: string | null;
  emoji: string;
  sort_order: number;
}

export function toTag(row: StoredDietaryTag): DietaryTag {
  return { key: row.key, label: row.label, labelEn: row.label_en, emoji: row.emoji };
}

/** The restaurant's own; the built-ins until theirs have loaded. */
export function tagsFor(stored?: StoredDietaryTag[] | null): DietaryTag[] {
  if (!stored?.length) return DIETARY_TAGS;
  return [...stored].sort((a, b) => a.sort_order - b.sort_order).map(toTag);
}

/**
 * How a tag reads.
 *
 * Built-ins by their translation; the ones the restaurant invented in its own
 * words, with the English if they bothered to add it. Never the bare `key`: a
 * diner has no business reading `gluten_free`.
 */
export function tagLabel(
  tag: DietaryTag,
  t: (key: string) => string,
  lang = "es",
): string {
  if (isBuiltIn(tag.key)) return t(`dietary.${tag.key}`);
  if (lang === "en" && tag.labelEn?.trim()) return tag.labelEn.trim();
  return tag.label;
}

/** Resolve stored keys against the governing list (unknown ones are dropped). */
export function dietaryTags(
  keys: string[] | null | undefined,
  all: DietaryTag[] = DIETARY_TAGS,
): DietaryTag[] {
  const byKey = new Map(all.map(t => [t.key, t]));
  return (keys ?? [])
    .map(k => byKey.get(k))
    .filter((t): t is DietaryTag => Boolean(t));
}

/**
 * The `key` a new tag gets, derived from its label.
 *
 * No accents or spaces, because it travels inside a text array and is compared
 * raw on three screens. If the label leaves nothing usable — only an emoji,
 * say — it returns empty and the caller decides.
 */
export function tagKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}
