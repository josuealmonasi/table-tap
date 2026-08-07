import { describe, expect, it } from "vitest";
import {
  applyChoices,
  comboCartLine,
  comboExtras,
  comboMissingRequired,
  type ComponentChoice,
} from "../combo-config";
import { priceCart } from "../pricing";
import type { ComboComponent, MenuItem } from "../types";
import type { Combo } from "../promotions";

const extra = (id: string, name: string, price: number): MenuItem =>
  ({ id, name, emoji: "🥛", price, available: true, modifiers: [] }) as unknown as MenuItem;

const extrasById = new Map([
  ["e-oat", extra("e-oat", "Oat milk", 0.7)],
  ["e-shot", extra("e-shot", "Extra shot", 1)],
]);

const components: ComboComponent[] = [
  { itemId: "coffee", name: "Coffee", emoji: "☕", qty: 1 },
  { itemId: "donut", name: "Donut", emoji: "🍩", qty: 1 },
];

const combo: Combo = {
  id: "c1",
  name: "Coffee & Donut",
  emoji: "🎁",
  description: null,
  price: 5,
  regularPrice: 7,
  components,
};

describe("comboExtras", () => {
  it("collects the extras chosen across components", () => {
    const choices: ComponentChoice[] = [
      { itemId: "coffee", mods: {}, extraIds: ["e-oat"] },
      { itemId: "donut", mods: {}, extraIds: [] },
    ];
    expect(comboExtras(choices, extrasById).map(e => e.id)).toEqual(["e-oat"]);
  });

  it("charges the same extra twice when two components take it", () => {
    // Two coffees each with oat milk is two upgrades, not one.
    const choices: ComponentChoice[] = [
      { itemId: "coffee", mods: {}, extraIds: ["e-oat"] },
      { itemId: "donut", mods: {}, extraIds: ["e-oat"] },
    ];
    expect(comboExtras(choices, extrasById)).toHaveLength(2);
  });

  it("ignores an extra that no longer exists", () => {
    const choices: ComponentChoice[] = [{ itemId: "coffee", mods: {}, extraIds: ["gone"] }];
    expect(comboExtras(choices, extrasById)).toEqual([]);
  });
});

describe("applyChoices", () => {
  it("attaches each instruction to its own component", () => {
    const got = applyChoices(
      components,
      [{ itemId: "coffee", mods: { Milk: "Oat" }, extraIds: ["e-shot"] }],
      extrasById,
    );
    expect(got[0].mods).toEqual({ Milk: "Oat" });
    expect(got[0].extras?.[0].name).toBe("Extra shot");
    // The donut was never configured, so it carries nothing.
    expect(got[1].mods).toBeUndefined();
    expect(got[1].extras).toBeUndefined();
  });
});

describe("comboMissingRequired", () => {
  const itemsById = new Map<string, MenuItem>([
    [
      "coffee",
      {
        id: "coffee",
        modifiers: [
          { label: "Size", type: "single", options: ["S", "L"], required: true },
        ],
      } as unknown as MenuItem,
    ],
    ["donut", { id: "donut", modifiers: [] } as unknown as MenuItem],
  ]);

  it("names the component that still needs a choice", () => {
    expect(comboMissingRequired(components, [], itemsById)).toEqual(["Coffee (Size)"]);
  });

  it("is satisfied once the component is configured", () => {
    const choices: ComponentChoice[] = [
      { itemId: "coffee", mods: { Size: "L" }, extraIds: [] },
    ];
    expect(comboMissingRequired(components, choices, itemsById)).toEqual([]);
  });

  it("ignores a component that left the menu", () => {
    expect(comboMissingRequired(components, [], new Map())).toEqual([]);
  });
});

describe("comboCartLine", () => {
  it("keeps the bundle price and hangs the extras off the line", () => {
    const line = comboCartLine(
      combo,
      [{ itemId: "coffee", mods: {}, extraIds: ["e-oat"] }],
      extrasById,
    );
    expect(line.price).toBe(5);
    expect(line.comboId).toBe("c1");
    expect(line.extras?.map(e => e.price)).toEqual([0.7]);
  });

  it("prices as bundle + extras, never re-discounting the bundle", () => {
    // The whole point: MX$5 deal, oat milk +0.70 and a shot +1.00 → 6.70.
    const line = comboCartLine(
      combo,
      [
        { itemId: "coffee", mods: {}, extraIds: ["e-oat", "e-shot"] },
        { itemId: "donut", mods: {}, extraIds: [] },
      ],
      extrasById,
    );
    const priced = priceCart({ items: [line], servicePct: 0, serviceEnabled: false });
    expect(priced.total).toBe(6.7);
  });

  it("a bundle with nothing added still costs exactly the deal price", () => {
    const line = comboCartLine(combo, [], extrasById);
    const priced = priceCart({ items: [line], servicePct: 0, serviceEnabled: false });
    expect(priced.total).toBe(5);
    expect(line.extras).toBeUndefined();
  });
});
