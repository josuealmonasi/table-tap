/** One emoji from the picker, with its name for the screen reader. */
export interface IconChoice {
  emoji: string;
  label: string;
}

export interface IconGroup {
  /** Empty on the built-ins: theirs can be deleted, ours cannot. */
  id?: string;
  /** The built-ins' translation key; their own carry a name already. */
  labelKey?: string;
  name: string;
  items: IconChoice[];
}

export type IconVariant = "product" | "addon";

/**
 * The built-in groups.
 *
 * A restaurant that has not built its own sees these, so the picker is never
 * empty — and one that has sees its own first, because they added them to
 * reach what they use every day sooner.
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

/** What the database returns: a group with its icons already attached. */
export interface StoredIconGroup {
  id: string;
  variant: IconVariant;
  name: string;
  sort_order: number;
  items: { emoji: string; label: string | null; sort_order: number }[];
}

/**
 * Which groups are shown: the restaurant's first, then ours.
 *
 * The built-ins are never hidden. An empty group of their own is not shown
 * either — a tab with nothing in it only disappoints whoever opens it.
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

/** A real emoji, and only one. */
export function isEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 8) return false;
  return /\p{Extended_Pictographic}/u.test(trimmed);
}
