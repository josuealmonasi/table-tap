import { describe, expect, it } from "vitest";
import { parseReserveResult, stockDemand, toDemandPayload } from "@/lib/stock";
import type { OrderLineItem } from "@/lib/types";

/** A plain cart line, with only the fields the demand count reads. */
function line(over: Partial<OrderLineItem> = {}): OrderLineItem {
  return {
    itemId: "dish-1",
    name: "Taco",
    emoji: "🌮",
    price: 30,
    qty: 1,
    mods: {},
    ...over,
  };
}

describe("stockDemand", () => {
  it("counts a plain line's quantity", () => {
    expect(stockDemand([line({ qty: 3 })])).toEqual([{ itemId: "dish-1", qty: 3 }]);
  });

  it("sums the same dish ordered on separate lines", () => {
    // One with onions and one without are two lines and one dish. Counting
    // them separately is how the last portion gets sold twice.
    const demand = stockDemand([
      line({ qty: 2, mods: { onions: "yes" } }),
      line({ qty: 3, mods: { onions: "no" } }),
    ]);
    expect(demand).toEqual([{ itemId: "dish-1", qty: 5 }]);
  });

  it("multiplies a combo's components by how many combos were ordered", () => {
    const demand = stockDemand([
      line({
        itemId: "combo-1",
        comboId: "combo-1",
        qty: 2,
        components: [
          { itemId: "burger", name: "Burger", emoji: "🍔", qty: 1 },
          { itemId: "fries", name: "Fries", emoji: "🍟", qty: 2 },
        ],
      }),
    ]);
    expect(demand).toEqual([
      { itemId: "burger", qty: 2 },
      { itemId: "fries", qty: 4 },
    ]);
  });

  it("does not consume the combo's own id", () => {
    // A combo is a promotion, not a dish on a shelf. Taking stock from its id
    // would decrement whatever menu item happened to share it.
    const demand = stockDemand([
      line({
        itemId: "combo-1",
        comboId: "combo-1",
        qty: 1,
        components: [{ itemId: "burger", name: "Burger", emoji: "🍔", qty: 1 }],
      }),
    ]);
    expect(demand.some(d => d.itemId === "combo-1")).toBe(false);
  });

  it("takes one extra per unit of the line", () => {
    const demand = stockDemand([
      line({
        qty: 3,
        extras: [{ id: "oat-milk", name: "Oat milk", emoji: "🥛", price: 10 }],
      }),
    ]);
    expect(demand).toContainEqual({ itemId: "oat-milk", qty: 3 });
  });

  it("counts a combo's extras once, not once per component", () => {
    // The cart copies a component's extras onto the line, so counting both
    // places would double every upgrade sold inside a deal.
    const demand = stockDemand([
      line({
        itemId: "combo-1",
        comboId: "combo-1",
        qty: 1,
        components: [
          {
            itemId: "coffee",
            name: "Coffee",
            emoji: "☕",
            qty: 1,
            extras: [{ id: "oat-milk", name: "Oat milk", emoji: "🥛", price: 10 }],
          },
        ],
        extras: [{ id: "oat-milk", name: "Oat milk", emoji: "🥛", price: 10 }],
      }),
    ]);
    expect(demand).toContainEqual({ itemId: "oat-milk", qty: 1 });
  });

  it("ignores a line asking for nothing", () => {
    expect(stockDemand([line({ qty: 0 })])).toEqual([]);
  });
});

describe("toDemandPayload", () => {
  it("renames to what the SQL function reads", () => {
    expect(toDemandPayload([{ itemId: "a", qty: 2 }])).toEqual([{ item_id: "a", qty: 2 }]);
  });
});

describe("parseReserveResult", () => {
  it("reads a successful reservation", () => {
    const result = parseReserveResult({ ok: true, short: [], low: [] });
    expect(result.ok).toBe(true);
  });

  it("reads a shortfall", () => {
    const result = parseReserveResult({
      ok: false,
      short: [{ item_id: "dish-1", name: "Taco", available: 5 }],
      low: [],
    });
    expect(result.ok).toBe(false);
    expect(result.short).toEqual([{ itemId: "dish-1", name: "Taco", available: 5 }]);
  });

  it("treats an unreadable answer as a refusal", () => {
    // A reservation we could not read is not permission to sell the food.
    expect(parseReserveResult(null).ok).toBe(false);
    expect(parseReserveResult({ nonsense: true }).ok).toBe(false);
  });

  it("keeps an unknown warning kind out of the out-of-stock bucket", () => {
    const result = parseReserveResult({
      ok: true,
      short: [],
      low: [{ item_id: "d", name: "N", stock: 2, kind: "something-else" }],
    });
    expect(result.low[0].kind).toBe("low_stock");
  });
});
