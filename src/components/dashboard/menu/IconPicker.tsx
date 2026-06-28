"use client";

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
    ],
  },
  {
    group: "Sides & bread",
    items: [
      { emoji: "🍟", label: "Fries" },
      { emoji: "🥔", label: "Potato" },
      { emoji: "🌽", label: "Corn" },
      { emoji: "🥖", label: "Bread" },
      { emoji: "🥐", label: "Croissant" },
      { emoji: "🥨", label: "Pretzel" },
      { emoji: "🥯", label: "Bagel" },
      { emoji: "🫓", label: "Flatbread" },
      { emoji: "🧀", label: "Cheese" },
      { emoji: "🥚", label: "Egg" },
      { emoji: "🍄", label: "Mushroom" },
      { emoji: "🥦", label: "Veg" },
    ],
  },
  {
    group: "Fruit",
    items: [
      { emoji: "🍎", label: "Apple" },
      { emoji: "🍓", label: "Strawberry" },
      { emoji: "🫐", label: "Blueberry" },
      { emoji: "🍌", label: "Banana" },
      { emoji: "🍋", label: "Lemon" },
      { emoji: "🍊", label: "Orange" },
      { emoji: "🍇", label: "Grapes" },
      { emoji: "🍉", label: "Watermelon" },
      { emoji: "🥭", label: "Mango" },
      { emoji: "🍍", label: "Pineapple" },
      { emoji: "🥥", label: "Coconut" },
      { emoji: "🍑", label: "Peach" },
      { emoji: "🍒", label: "Cherry" },
      { emoji: "🥝", label: "Kiwi" },
      { emoji: "🥑", label: "Avocado" },
      { emoji: "🍅", label: "Tomato" },
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
  {
    group: "Extras & condiments",
    items: [
      { emoji: "🍽️", label: "Dish" },
      { emoji: "🥢", label: "Chopsticks" },
      { emoji: "🧂", label: "Salt" },
      { emoji: "🧈", label: "Butter" },
      { emoji: "🌶️", label: "Chili" },
      { emoji: "🧄", label: "Garlic" },
      { emoji: "🧅", label: "Onion" },
      { emoji: "🥫", label: "Sauce" },
    ],
  },
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

      <div className="tt-chips" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`tt-chip ${value ? "" : "tt-chip-on"}`}
          onClick={() => onChange("")}
        >
          None
        </button>
      </div>

      {ICON_GROUPS.map((g) => (
        <div key={g.group} style={{ marginBottom: 12 }}>
          <div
            className="tt-muted"
            style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}
          >
            {g.group}
          </div>
          <div className="tt-chips">
            {g.items.map((o) => (
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
      ))}
    </div>
  );
}
