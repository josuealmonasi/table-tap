"use client";

// A small curated set of item types → icons, so users pick a type instead of
// typing an arbitrary emoji. "None" leaves the item without an icon.
const ICON_OPTIONS: { emoji: string; label: string }[] = [
  { emoji: "🍽️", label: "Dish" },
  { emoji: "🍔", label: "Burger" },
  { emoji: "🌭", label: "Hot dog" },
  { emoji: "🍕", label: "Pizza" },
  { emoji: "🥗", label: "Salad" },
  { emoji: "🍟", label: "Side" },
  { emoji: "🍣", label: "Sushi" },
  { emoji: "🍜", label: "Noodles" },
  { emoji: "☕", label: "Coffee" },
  { emoji: "🍵", label: "Tea" },
  { emoji: "🥤", label: "Cold drink" },
  { emoji: "🍺", label: "Beer" },
  { emoji: "🍷", label: "Wine" },
  { emoji: "🍰", label: "Dessert" },
  { emoji: "🍦", label: "Ice cream" },
  { emoji: "🧂", label: "Sauce" },
  { emoji: "🧀", label: "Cheese" },
];

/** Optional icon/type picker. value is the chosen emoji ("" = no icon). */
export default function IconPicker({
  value,
  onChange,
  label = "Type / icon (optional)",
}: {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
}) {
  return (
    <div>
      <div className="tt-mod-label">{label}</div>
      <div className="tt-chips">
        <button
          type="button"
          className={`tt-chip ${value ? "" : "tt-chip-on"}`}
          onClick={() => onChange("")}
        >
          None
        </button>
        {ICON_OPTIONS.map((o) => (
          <button
            type="button"
            key={o.emoji}
            className={`tt-chip ${value === o.emoji ? "tt-chip-on" : ""}`}
            onClick={() => onChange(o.emoji)}
          >
            {o.emoji} {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
