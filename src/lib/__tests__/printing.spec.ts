import { describe, expect, it } from "vitest";
import { newPrinterToken, slipFor, TOKEN_SHAPE } from "@/lib/printing";
import type { Order } from "@/lib/types";

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "62cb66d5-b5e0-4429-954b-e78488cc58f8",
    restaurant_id: "r",
    table_label: "7",
    paid: true,
    note: null,
    items: [
      { itemId: "a", name: "Katsu Curry", emoji: "🍱", price: 12.5, qty: 2, mods: {} },
    ],
    ...over,
  }) as unknown as Order;

describe("the printer's credential", () => {
  it("is long enough that nobody guesses it", () => {
    // A uuid is 122 bits and half the world treats one as guessable. This is
    // the only thing standing between a stranger and a restaurant's slips.
    const token = newPrinterToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(TOKEN_SHAPE.test(token)).toBe(true);
    expect(newPrinterToken()).not.toBe(token);
  });

  it("refuses anything that is not one of ours", () => {
    for (const bad of ["", "abc", "../../etc/passwd", "a".repeat(200), "tok en"]) {
      expect(TOKEN_SHAPE.test(bad)).toBe(false);
    }
  });
});

describe("the slip", () => {
  it("leads with where it goes and what it is called", () => {
    const [where, code] = slipFor(order(), "ORD-62CB").split("\n");
    expect(where).toBe("MESA 7");
    expect(code).toBe("ORD-62CB");
  });

  it("says PARA LLEVAR when there is no table", () => {
    expect(slipFor(order({ table_label: null }), "ORD-1").split("\n")[0]).toBe("PARA LLEVAR");
  });

  it("never prints a price", () => {
    // The kitchen does not take money, and a total on the slip only invites
    // somebody to hand it over as the bill.
    const slip = slipFor(order(), "ORD-1");
    expect(slip).not.toMatch(/\d+\.\d{2}/);
    expect(slip).not.toContain("$");
  });

  it("shouts a dish note, because that is the allergy", () => {
    const slip = slipFor(
      order({ items: [{ itemId: "a", name: "Pad Thai", emoji: "🍜", price: 1, qty: 1, mods: {}, notes: "sin cacahuate" }] } as Partial<Order>),
      "ORD-1",
    );
    expect(slip).toContain("SIN CACAHUATE");
  });

  it("warns when the food has not been paid for", () => {
    expect(slipFor(order({ paid: false }), "ORD-1")).toContain("NO PAGADO");
    expect(slipFor(order({ paid: true }), "ORD-1")).not.toContain("NO PAGADO");
  });

  it("keeps every line inside the paper", () => {
    const long = "Ensalada de la casa con aderezo de la abuela y muchas cosas más encima";
    const slip = slipFor(
      order({ items: [{ itemId: "a", name: long, emoji: "🥗", price: 1, qty: 1, mods: { Aderezo: "ranch" }, notes: long }] } as Partial<Order>),
      "ORD-1",
    );
    for (const line of slip.split("\n")) expect(line.length).toBeLessThanOrEqual(42);
  });
});
