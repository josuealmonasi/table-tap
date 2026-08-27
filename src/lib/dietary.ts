/**
 * Etiquetas de dieta y alérgenos.
 *
 * La lista es del restaurante: se guarda en `dietary_tags` y él la arma. Estas
 * ocho son sólo el punto de partida —las mismas que la base siembra— y siguen
 * aquí por dos razones: para traducir las de casa por su `key`, y para que una
 * pantalla que todavía no cargó las suyas enseñe algo sensato en vez de nada.
 *
 * Lo que se guarda dentro del platillo es la `key`, nunca el rótulo. Renombrar
 * una etiqueta no la despega de los platillos que ya la traen.
 */
export interface DietaryTag {
  key: string;
  label: string;
  /** Sólo las propias del restaurante; las de casa se traducen por su `key`. */
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

/** Las que tienen traducción propia en `i18n.dietary`. */
const BUILT_IN = new Set(DIETARY_TAGS.map(t => t.key));

export const isBuiltIn = (key: string): boolean => BUILT_IN.has(key);

/** Lo que devuelve la base, tal cual. */
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

/** Las del restaurante; las de casa mientras no haya cargado las suyas. */
export function tagsFor(stored?: StoredDietaryTag[] | null): DietaryTag[] {
  if (!stored?.length) return DIETARY_TAGS;
  return [...stored].sort((a, b) => a.sort_order - b.sort_order).map(toTag);
}

/**
 * Cómo se lee una etiqueta.
 *
 * Las de casa por su traducción; las que inventó el restaurante en sus propias
 * palabras, con el inglés si se molestó en ponerlo. Nunca la `key` a secas: un
 * comensal no tiene por qué leer `gluten_free`.
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

/** Resuelve las claves guardadas contra la lista que rige (las desconocidas se caen). */
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
 * La `key` que le toca a una etiqueta nueva, a partir de su rótulo.
 *
 * Sin acentos ni espacios porque viaja dentro de un arreglo de texto y se
 * compara en crudo en tres pantallas. Si el rótulo no deja nada utilizable
 * —sólo emoji, por ejemplo— devuelve vacío y el que llama decide.
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
