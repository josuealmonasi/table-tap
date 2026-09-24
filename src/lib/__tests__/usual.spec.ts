import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetUsual, readUsual, rememberUsual, resolveUsual, USUAL_MAX_LINES } from "@/lib/usual";
import type { MenuItem, OrderLineItem } from "@/lib/types";

const R = "rest-1";

/** A localStorage of our own, as in recent-order.spec: plain Node, one Map. */
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

function dish(id: string, over: Partial<MenuItem> = {}): MenuItem {
  return {
    id, name: `Dish ${id}`, emoji: "🍽️", price: 10, available: true, modifiers: [], discount_pct: 0,
    ...over,
  } as MenuItem;
}
const line = (itemId: string, over: Partial<OrderLineItem> = {}): OrderLineItem => ({
  itemId, name: itemId, emoji: "🍽️", price: 99, qty: 1, mods: {}, ...over,
});

const coleslaw = dish("coleslaw", { price: 3.5 });
const guac = dish("guac", { price: 2.2, name: "Guacamole" });
const tacos = dish("tacos", {
  price: 10.5,
  modifiers: [{ label: "Salsa", type: "single", options: ["Verde", "Roja"], required: true }],
});
const menu = [coleslaw, tacos];
const extras = [guac];
const extrasByProduct = { coleslaw: ["guac"] };

describe("what the phone remembers", () => {
  it("counts the same line across orders, whatever order its extras and options came in", () => {
    rememberUsual(R, [line("tacos", { mods: { Salsa: "Verde" } })]);
    rememberUsual(R, [line("tacos", { mods: { Salsa: "Verde" } })]);
    const [entry] = readUsual(R);
    expect(entry.count).toBe(2);
  });

  it("keeps a different choice as a different line", () => {
    rememberUsual(R, [line("tacos", { mods: { Salsa: "Verde" } })]);
    rememberUsual(R, [line("tacos", { mods: { Salsa: "Roja" } })]);
    expect(readUsual(R)).toHaveLength(2);
  });

  it("leaves combos out: a bundle is a deal, not a habit", () => {
    rememberUsual(R, [line("combo-1", { comboId: "combo-1" })]);
    expect(readUsual(R)).toEqual([]);
  });

  it("forgets everything when asked", () => {
    rememberUsual(R, [line("coleslaw")]);
    forgetUsual(R);
    expect(readUsual(R)).toEqual([]);
  });

  it("never breaks when the phone cannot store anything", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(() => rememberUsual(R, [line("coleslaw")])).not.toThrow();
    expect(readUsual(R)).toEqual([]);
  });
});

describe("what the menu offers back", () => {
  const twice = (l: OrderLineItem) => { rememberUsual(R, [l]); rememberUsual(R, [l]); };

  it("offers a habit — twice or more — and not a one-off", () => {
    rememberUsual(R, [line("coleslaw")]);
    expect(resolveUsual(readUsual(R), menu, extras, extrasByProduct)).toEqual([]);
    rememberUsual(R, [line("coleslaw")]);
    expect(resolveUsual(readUsual(R), menu, extras, extrasByProduct)).toHaveLength(1);
  });

  it("prices it at today's menu, never at what was remembered", () => {
    twice(line("coleslaw", { price: 1, extras: [{ id: "guac", name: "old", emoji: "", price: 0.1 }] }));
    const [offered] = resolveUsual(readUsual(R), menu, extras, extrasByProduct);
    expect(offered.price).toBe(3.5);
    expect(offered.extras).toEqual([{ id: "guac", name: "Guacamole", emoji: "🍽️", price: 2.2 }]);
  });

  it("leaves out a line whose dish is off the menu or sold out", () => {
    twice(line("coleslaw"));
    expect(resolveUsual(readUsual(R), [], extras, extrasByProduct)).toEqual([]);
    expect(resolveUsual(readUsual(R), [dish("coleslaw", { available: false })], extras, extrasByProduct)).toEqual([]);
  });

  it("leaves out a line whose extra is gone, rather than serving it without", () => {
    twice(line("coleslaw", { extras: [{ id: "guac", name: "Guacamole", emoji: "", price: 2.2 }] }));
    expect(resolveUsual(readUsual(R), menu, [dish("guac", { available: false })], extrasByProduct)).toEqual([]);
    expect(resolveUsual(readUsual(R), menu, extras, { coleslaw: [] })).toEqual([]);
  });

  it("leaves out a line whose option no longer exists, or that now needs one", () => {
    twice(line("tacos", { mods: { Salsa: "Habanero" } }));
    expect(resolveUsual(readUsual(R), menu, extras, extrasByProduct)).toEqual([]);
    store.clear();
    twice(line("tacos"));
    expect(resolveUsual(readUsual(R), menu, extras, extrasByProduct)).toEqual([]);
  });

  it(`offers the most ordered first, and no more than ${USUAL_MAX_LINES}`, () => {
    const many = ["a", "b", "c", "d"].map(id => dish(id));
    for (let n = 0; n < 5; n++) rememberUsual(R, [line("d")]);
    for (const id of ["a", "b", "c"]) { rememberUsual(R, [line(id)]); rememberUsual(R, [line(id)]); }
    const offered = resolveUsual(readUsual(R), many, [], {});
    expect(offered).toHaveLength(USUAL_MAX_LINES);
    expect(offered[0].itemId).toBe("d");
  });
});
