"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

type IconGroup = { group: string; items: { emoji: string; label: string }[] };

// Group header → translation key.
const GROUP_KEY: Record<string, string> = {
  Meals: "menu.groupMeals",
  Drinks: "menu.groupDrinks",
  Condiments: "menu.groupCondiments",
  "Beverage add-ons": "menu.groupBeverageAddons",
};

// Sections already group by type (e.g. "Coffee Drinks"), so this just
// distinguishes meals vs. drinks at a glance. 🍽️ is the generic default.
const PRODUCT_ICON_GROUPS: IconGroup[] = [
  {
    group: "Meals",
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
    group: "Drinks",
    items: [
      { emoji: "☕", label: "Coffee" },
      { emoji: "🍵", label: "Tea" },
      { emoji: "🥤", label: "Soft drink" },
      { emoji: "🧃", label: "Juice" },
      { emoji: "🍺", label: "Beer" },
      { emoji: "🍷", label: "Wine" },
    ],
  },
];

// Extras are condiments and a couple of complimentary beverage add-ons —
// never a full dish.
const ADDON_ICON_GROUPS: IconGroup[] = [
  {
    group: "Condiments",
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
    group: "Beverage add-ons",
    items: [
      { emoji: "🥛", label: "Milk" },
      { emoji: "☕", label: "Coffee" },
    ],
  },
];

/** Which group contains the currently chosen emoji (so we can open it by default). */
function findGroupWith(groups: IconGroup[], value: string) {
  if (!value) return null;
  return groups.find(g => g.items.some(i => i.emoji === value))?.group ?? null;
}

/**
 * Icon picker, single-open accordion. value is the chosen emoji ("" = none).
 * variant picks the icon set: "product" (meals/drinks) or "addon" (condiments/
 * beverage add-ons).
 */
export default function IconPicker({
  value,
  onChange,
  label,
  variant = "product",
}: {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
  variant?: "product" | "addon";
}) {
  const t = useT();
  const groups = variant === "addon" ? ADDON_ICON_GROUPS : PRODUCT_ICON_GROUPS;
  const [openGroup, setOpenGroup] = useState<string | null>(() =>
    findGroupWith(groups, value),
  );

  return (
    <div>
      <div className="tt-mod-label">{label ?? t("menu.iconOptional")}</div>

      <div className="tt-accordion">
        {groups.map(g => {
          const isOpen = openGroup === g.group;
          const selected = g.items.find(i => i.emoji === value);
          return (
            <div key={g.group} className="tt-acc-item">
              <button
                type="button"
                className="tt-acc-head"
                aria-expanded={isOpen}
                onClick={() => setOpenGroup(isOpen ? null : g.group)}
              >
                <span>{t(GROUP_KEY[g.group] ?? g.group)}</span>
                <span className="tt-acc-right">
                  {selected && <span style={{ fontSize: 15 }}>{selected.emoji}</span>}
                  <span className="tt-acc-chevron">{isOpen ? "▾" : "▸"}</span>
                </span>
              </button>
              {isOpen && (
                <div className="tt-chips tt-acc-body">
                  {g.items.map(o => (
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
