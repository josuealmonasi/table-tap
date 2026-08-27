/** Un emoji del selector, con su nombre para el lector de pantalla. */
export interface IconChoice {
  emoji: string;
  label: string;
}

export interface IconGroup {
  /** Vacío en los de fábrica: los suyos se borran, los nuestros no. */
  id?: string;
  /** La clave de traducción de los de fábrica; los propios traen nombre puesto. */
  labelKey?: string;
  name: string;
  items: IconChoice[];
}

export type IconVariant = "product" | "addon";

/**
 * Los grupos de fábrica.
 *
 * Un restaurante que no ha armado los suyos ve estos, así que el selector
 * nunca aparece vacío — y el que sí los armó ve los suyos primero, porque los
 * puso para encontrar antes lo que usa todos los días.
 */
export const DEFAULT_ICON_GROUPS: Record<IconVariant, IconGroup[]> = {
  product: [
    {
      labelKey: "menu.groupMeals",
      name: "Meals",
      items: [
        { emoji: "🍽️", label: "Dish" },
        { emoji: "🍔", label: "Burger" },
        { emoji: "🍕", label: "Pizza" },
        { emoji: "🌭", label: "Hot dog" },
        { emoji: "🌮", label: "Taco" },
        { emoji: "🍝", label: "Pasta" },
        { emoji: "🍜", label: "Noodles" },
        { emoji: "🍣", label: "Sushi" },
        { emoji: "🍳", label: "Breakfast" },
        { emoji: "🥗", label: "Salad" },
        { emoji: "🍗", label: "Chicken" },
        { emoji: "🥩", label: "Meat" },
        { emoji: "🥪", label: "Sandwich" },
      ],
    },
    {
      labelKey: "menu.groupDrinks",
      name: "Drinks",
      items: [
        { emoji: "☕", label: "Coffee" },
        { emoji: "🍵", label: "Tea" },
        { emoji: "🥤", label: "Soft drink" },
        { emoji: "🧃", label: "Juice" },
        { emoji: "🍺", label: "Beer" },
        { emoji: "🍷", label: "Wine" },
      ],
    },
  ],
  addon: [
    {
      labelKey: "menu.groupCondiments",
      name: "Condiments",
      items: [
        { emoji: "🧂", label: "Salt" },
        { emoji: "🌶️", label: "Chili" },
        { emoji: "🧄", label: "Garlic" },
        { emoji: "🍯", label: "Honey" },
        { emoji: "🥫", label: "Sauce" },
        { emoji: "🧈", label: "Butter" },
      ],
    },
    {
      labelKey: "menu.groupBeverageAddons",
      name: "Beverage add-ons",
      items: [
        { emoji: "🥛", label: "Milk" },
        { emoji: "☕", label: "Coffee" },
      ],
    },
  ],
};

/** Lo que devuelve la base: un grupo con sus iconos ya pegados. */
export interface StoredIconGroup {
  id: string;
  variant: IconVariant;
  name: string;
  sort_order: number;
  items: { emoji: string; label: string | null; sort_order: number }[];
}

/**
 * Los grupos que se enseñan: primero los del restaurante, luego los de fábrica.
 *
 * Los de fábrica no se esconden nunca. Un grupo propio vacío tampoco se enseña
 * — una pestaña sin nada dentro es una pestaña que decepciona a quien la abre.
 */
export function groupsFor(
  variant: IconVariant,
  stored: StoredIconGroup[] = [],
): IconGroup[] {
  const mine = stored
    .filter(g => g.variant === variant && g.items.length > 0)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(g => ({
      id: g.id,
      name: g.name,
      items: [...g.items]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(i => ({ emoji: i.emoji, label: i.label ?? i.emoji })),
    }));

  return [...mine, ...DEFAULT_ICON_GROUPS[variant]];
}

/** Un emoji de verdad, y uno solo. */
export function isEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 8) return false;
  return /\p{Extended_Pictographic}/u.test(trimmed);
}
