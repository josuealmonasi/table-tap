"use client";

import { useState } from "react";

// Curated icon sets grouped by type, so users pick a fitting icon for any item
// instead of typing an arbitrary emoji. "None" leaves the item without an icon.
const ICON_GROUPS: { group: string; items: { emoji: string; label: string }[] }[] = [
  {
    group: "Mains",
    items: [
      { emoji: "🍔", label: "Burger" },
      { emoji: "🌭", label: "Hot dog" },
      { emoji: "🍕", label: "Pizza" },
      { emoji: "🌮", label: "Taco" },
      { emoji: "🌯", label: "Burrito" },
      { emoji: "🥙", label: "Wrap / pita" },
      { emoji: "🧆", label: "Falafel" },
      { emoji: "🥪", label: "Sandwich" },
      { emoji: "🫔", label: "Tamale" },
      { emoji: "🍝", label: "Pasta" },
      { emoji: "🍜", label: "Ramen / noodles" },
      { emoji: "🍲", label: "Stew / hot pot" },
      { emoji: "🥘", label: "Paella / skillet" },
      { emoji: "🍛", label: "Curry" },
      { emoji: "🍱", label: "Bento" },
      { emoji: "🍣", label: "Sushi" },
      { emoji: "🍙", label: "Onigiri" },
      { emoji: "🍤", label: "Tempura / shrimp" },
      { emoji: "🥟", label: "Dumpling" },
      { emoji: "🍗", label: "Chicken" },
      { emoji: "🍖", label: "Meat" },
      { emoji: "🥩", label: "Steak" },
      { emoji: "🥓", label: "Bacon" },
      { emoji: "🍳", label: "Eggs / breakfast" },
      { emoji: "🥞", label: "Pancakes" },
      { emoji: "🧇", label: "Waffle" },
      { emoji: "🍚", label: "Rice" },
      { emoji: "🫕", label: "Fondue" },
      { emoji: "🥗", label: "Salad" },
      { emoji: "🐟", label: "Fish" },
      { emoji: "🦐", label: "Shrimp" },
      { emoji: "🦞", label: "Lobster" },
      { emoji: "🦀", label: "Crab" },
      { emoji: "🦪", label: "Oyster" },
      { emoji: "🍟", label: "Fries" },
      { emoji: "🥐", label: "Croissant" },
      { emoji: "🥖", label: "Bread" },
    ],
  },
  {
    group: "Drinks",
    items: [
      { emoji: "☕", label: "Coffee" },
      { emoji: "🍵", label: "Tea" },
      { emoji: "🫖", label: "Teapot" },
      { emoji: "🥤", label: "Soft drink" },
      { emoji: "🧋", label: "Bubble tea" },
      { emoji: "🧃", label: "Juice" },
      { emoji: "🥛", label: "Milk" },
      { emoji: "💧", label: "Water" },
      { emoji: "🍺", label: "Beer" },
      { emoji: "🍻", label: "Beers" },
      { emoji: "🍷", label: "Wine" },
      { emoji: "🥂", label: "Champagne" },
      { emoji: "🍸", label: "Cocktail" },
      { emoji: "🍹", label: "Tropical" },
      { emoji: "🍶", label: "Sake" },
      { emoji: "🥃", label: "Whiskey" },
      { emoji: "🧉", label: "Mate" },
      { emoji: "🍾", label: "Bottle" },
    ],
  },
  {
    group: "Desserts & sweets",
    items: [
      { emoji: "🍰", label: "Cake slice" },
      { emoji: "🎂", label: "Cake" },
      { emoji: "🧁", label: "Cupcake" },
      { emoji: "🥧", label: "Pie" },
      { emoji: "🍦", label: "Soft serve" },
      { emoji: "🍨", label: "Ice cream" },
      { emoji: "🍧", label: "Shaved ice" },
      { emoji: "🍩", label: "Donut" },
      { emoji: "🍪", label: "Cookie" },
      { emoji: "🍫", label: "Chocolate" },
      { emoji: "🍬", label: "Candy" },
      { emoji: "🍭", label: "Lollipop" },
      { emoji: "🍮", label: "Pudding" },
      { emoji: "🍯", label: "Honey" },
      { emoji: "🍡", label: "Dango" },
      { emoji: "🌰", label: "Chestnut" },
    ],
  },
];

// Extras are toppings / sauces / extras — never a full dish. Smaller, focused set.
const ADDON_GROUPS: { group: string; items: { emoji: string; label: string }[] }[] = [
  {
    group: "Toppings",
    items: [
      { emoji: "🧀", label: "Cheese" },
      { emoji: "🥓", label: "Bacon" },
      { emoji: "🍳", label: "Egg" },
      { emoji: "🍄", label: "Mushroom" },
      { emoji: "🥑", label: "Avocado" },
      { emoji: "🍅", label: "Tomato" },
      { emoji: "🥬", label: "Lettuce" },
      { emoji: "🧅", label: "Onion" },
      { emoji: "🥒", label: "Pickle" },
      { emoji: "🫑", label: "Pepper" },
      { emoji: "🌽", label: "Corn" },
      { emoji: "🫒", label: "Olive" },
      { emoji: "🥜", label: "Peanuts" },
      { emoji: "🍤", label: "Shrimp" },
    ],
  },
  {
    group: "Sauces & seasoning",
    items: [
      { emoji: "🥫", label: "Sauce" },
      { emoji: "🧂", label: "Salt" },
      { emoji: "🧈", label: "Butter" },
      { emoji: "🌶️", label: "Chili" },
      { emoji: "🧄", label: "Garlic" },
      { emoji: "🍯", label: "Honey" },
      { emoji: "🍋", label: "Lemon" },
      { emoji: "🫚", label: "Ginger" },
      { emoji: "🌿", label: "Herbs" },
    ],
  },
  {
    group: "Sweet toppings",
    items: [
      { emoji: "🍫", label: "Chocolate" },
      { emoji: "🍓", label: "Strawberry" },
      { emoji: "🍌", label: "Banana" },
      { emoji: "🥥", label: "Coconut" },
      { emoji: "🍒", label: "Cherry" },
      { emoji: "🌰", label: "Nuts" },
      { emoji: "🍪", label: "Cookie crumble" },
    ],
  },
  {
    group: "Drink extras",
    items: [
      { emoji: "🥛", label: "Milk" },
      { emoji: "🧊", label: "Ice" },
      { emoji: "☕", label: "Extra shot" },
      { emoji: "🧋", label: "Pearls" },
    ],
  },
];

type IconGroups = { group: string; items: { emoji: string; label: string }[] }[];

/** Which group contains the currently chosen emoji (so we can open it by default). */
function findGroupWith(groups: IconGroups, value: string) {
  if (!value) return null;
  return groups.find((g) => g.items.some((i) => i.emoji === value))?.group ?? null;
}

/**
 * Optional icon/type picker. value is the chosen emoji ("" = no icon). Groups
 * are a single-open accordion to keep the form compact.
 */
export default function IconPicker({
  value,
  onChange,
  label = "Type / icon (optional)",
  variant = "product",
}: {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
  variant?: "product" | "addon";
}) {
  const groups = variant === "addon" ? ADDON_GROUPS : ICON_GROUPS;
  // Open the group holding the current selection (if any); otherwise all closed.
  const [openGroup, setOpenGroup] = useState<string | null>(() => findGroupWith(groups, value));

  return (
    <div>
      <div className="tt-mod-label">{label}</div>

      <div className="tt-accordion">
        {groups.map((g) => {
          const isOpen = openGroup === g.group;
          const selected = g.items.find((i) => i.emoji === value);
          return (
            <div key={g.group} className="tt-acc-item">
              <button
                type="button"
                className="tt-acc-head"
                aria-expanded={isOpen}
                onClick={() => setOpenGroup(isOpen ? null : g.group)}
              >
                <span>{g.group}</span>
                <span className="tt-acc-right">
                  {selected && <span style={{ fontSize: 15 }}>{selected.emoji}</span>}
                  <span className="tt-acc-chevron">{isOpen ? "▾" : "▸"}</span>
                </span>
              </button>
              {isOpen && (
                <div className="tt-chips tt-acc-body">
                  {g.items.map((o) => (
                    <button
                      type="button"
                      key={o.emoji}
                      className={`tt-chip ${value === o.emoji ? "tt-chip-on" : ""}`}
                      // Toggle: click to select, click the selected one again to clear.
                      onClick={() => onChange(value === o.emoji ? "" : o.emoji)}
                    >
                      {o.emoji} {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
