"use client";

import { useState } from "react";

// A few common icons per category. Sections already group by type (e.g. "Coffee
// Drinks"), so this just distinguishes meals / drinks / extras at a glance.
const ICON_GROUPS: { group: string; items: { emoji: string; label: string }[] }[] = [
  {
    group: "Meals",
    items: [
      { emoji: "🍔", label: "Burger" },
      { emoji: "🍕", label: "Pizza" },
      { emoji: "🌭", label: "Hot dog" },
      { emoji: "🌮", label: "Taco" },
      { emoji: "🍜", label: "Noodles" },
      { emoji: "🍣", label: "Sushi" },
      { emoji: "🍳", label: "Breakfast" },
      { emoji: "🥗", label: "Salad" },
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
  {
    group: "Extras",
    items: [
      { emoji: "🍟", label: "Fries" },
      { emoji: "🍪", label: "Cookie" },
      { emoji: "🍰", label: "Cake" },
      { emoji: "🍩", label: "Donut" },
      { emoji: "🧀", label: "Cheese" },
      { emoji: "🥖", label: "Bread" },
    ],
  },
];

/** Which group contains the currently chosen emoji (so we can open it by default). */
function findGroupWith(value: string) {
  if (!value) return null;
  return ICON_GROUPS.find((g) => g.items.some((i) => i.emoji === value))?.group ?? null;
}

/**
 * Icon picker for a product: meals / drinks / extras, single-open accordion.
 * value is the chosen emoji ("" = none, falls back to 🍽️ wherever it's shown).
 */
export default function IconPicker({
  value,
  onChange,
  label = "Icon (optional)",
}: {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(() => findGroupWith(value));

  return (
    <div>
      <div className="tt-mod-label">{label}</div>

      <div className="tt-accordion">
        {ICON_GROUPS.map((g) => {
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
