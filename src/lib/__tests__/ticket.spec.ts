import { describe, expect, it } from "vitest";
import { kitchenTicket, modsOf, wrap, TICKET_COLUMNS } from "@/lib/ticket";
import type { OrderLineItem } from "@/lib/types";

const t = (key: string, vars?: Record<string, string | number>) =>
  key === "ticket.table"
    ? `Table ${vars?.label}`
    : key === "ticket.counterFor"
      ? `Counter · ${vars?.name}`
      : key === "ticket.counter"
        ? "Counter"
        : key === "ticket.handedOver"
          ? "Handed over at the counter:"
          : key === "ticket.note"
            ? "Note"
            : key;

const place = { name: "El Fogón", timeZone: "America/Mexico_City" };

function order(items: OrderLineItem[], extra: Record<string, unknown> = {}) {
  return {
    id: "5b761234-0000-4000-8000-000000000000",
    items,
    created_at: "2026-09-08T18:30:00.000Z",
    ...extra,
  };
}

const dish = (over: Partial<OrderLineItem> = {}): OrderLineItem => ({
  itemId: "i1",
  name: "Hamburguesa",
  emoji: "🍔",
  price: 120,
  qty: 1,
  mods: {},
  ...over,
});

describe("kitchenTicket", () => {
  it("names the order and where it goes", () => {
    const text = kitchenTicket(order([dish()]), place, t);
    expect(text).toContain("ORD-5B76");
    expect(text).toContain("El Fogón");
    expect(text).toContain("Counter");
  });

  it("carries no money at all — a cook does not read totals off the paper", () => {
    const text = kitchenTicket(order([dish()]), place, t);
    expect(text).not.toContain("120");
    expect(text).not.toMatch(/\$|MX\$/);
  });

  it("puts the special request where a cook scanning the ticket will see it", () => {
    const text = kitchenTicket(order([dish({ notes: "bien cocida" })]), place, t);
    expect(text).toContain("   >> bien cocida");
  });

  it("lists a combo's components, not the combo's copied extras", () => {
    // A combo's component extras are ALSO copied onto the parent line for
    // pricing. Printing both would tell the kitchen to add the cheese twice.
    const cheese = { id: "e1", name: "Queso extra", emoji: "🧀", price: 15 };
    const text = kitchenTicket(
      order([
        dish({
          comboId: "c1",
          name: "Combo Familiar",
          extras: [cheese],
          components: [
            { itemId: "i1", name: "Hamburguesa", emoji: "🍔", qty: 2, extras: [cheese] },
            { itemId: "i2", name: "Papas", emoji: "🍟", qty: 1 },
          ],
        }),
      ]),
      place,
      t,
    );
    expect(text).toContain("2 x Hamburguesa");
    expect(text).toContain("1 x Papas");
    expect(text.match(/Queso extra/g)).toHaveLength(1);
  });

  it("keeps handed-over lines off the cook's list but still on the paper", () => {
    const text = kitchenTicket(
      order([dish(), dish({ itemId: "i9", name: "Agua embotellada", skipsKitchen: true })]),
      place,
      t,
    );
    const madeSection = text.split("Handed over")[0];
    expect(madeSection).toContain("Hamburguesa");
    expect(madeSection).not.toContain("Agua embotellada");
    expect(text).toContain("Handed over at the counter:");
    expect(text).toContain("1 x Agua embotellada");
  });

  it("never runs a line past the edge of the paper", () => {
    const text = kitchenTicket(
      order(
        [
          dish({
            name: "Hamburguesa doble con tocino, aguacate y queso manchego añejo",
            notes: "sin sal, sin pimienta, el pan bien tostado por los dos lados",
            mods: { termino: "Tres cuartos", guarnicion: ["Papas a la francesa", "Ensalada"] },
          }),
        ],
        { note: "Para llevar, todo en bolsas separadas por favor, van a dos mesas" },
      ),
      // A name long enough to need wrapping before it can be centred.
      { ...place, name: "Restaurante y Cantina La Casa de Doña Remedios del Centro" },
      t,
    );
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(TICKET_COLUMNS);
  });

  it("ends with paper to spare, because the head tears above the last line", () => {
    expect(kitchenTicket(order([dish()]), place, t)).toMatch(/\n\n\n$/);
  });
});

describe("wrap", () => {
  it("indents every line, not only the ones after a break", () => {
    // The split eats leading whitespace, so an indent written into the text
    // survives on the continuation lines and vanishes from the first — which
    // printed every modifier flush against the dish above it.
    const lines = wrap("palabra ".repeat(12).trim(), 3);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.startsWith("   ")).toBe(true);
  });

  it("hard-splits a word longer than the paper rather than losing it", () => {
    const word = "x".repeat(TICKET_COLUMNS + 10);
    expect(wrap(word).join("")).toContain(word);
  });
});

describe("modsOf", () => {
  it("reads the way the kitchen board writes it", () => {
    expect(modsOf({ mods: { size: "Grande", extras: ["sin cebolla", "sin jitomate"] } })).toBe(
      "Grande · sin cebolla, sin jitomate",
    );
  });
});
