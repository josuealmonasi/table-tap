import { describe, expect, it } from "vitest";
import { inStation, linesAt, stationsOf, viewStatus } from "@/lib/stations";
import { kitchenTicket } from "@/lib/ticket";
import type { Order, OrderLineItem } from "@/lib/types";

/**
 * A café asked for drinks to go to the barista and food to the kitchen. One
 * order holds both; each station sees and finishes its own part.
 */

const line = (name: string, over: Partial<OrderLineItem> = {}): OrderLineItem =>
  ({ itemId: name, name, emoji: "", price: 10, qty: 1, mods: {}, ...over });
const order = (items: OrderLineItem[], over: Partial<Order> = {}): Order =>
  ({ id: "00000000-0000-4000-8000-0000000000ab", items, status: "preparing", stations_ready: [], created_at: "2026-10-14T15:00:00Z", table_label: "4", ...over }) as Order;

const latte = line("Latte", { station: "bar" });
const sandwich = line("Sándwich");
const water = line("Agua", { skipsKitchen: true, station: "bar" });

describe("an order's stations", () => {
  it("are those of the lines that are made at all", () => {
    expect(stationsOf(order([latte, sandwich, water]))).toEqual(["kitchen", "bar"]);
    expect(stationsOf(order([sandwich, water]))).toEqual(["kitchen"]);
  });

  it("show each station its own lines, and everything to nobody in particular", () => {
    const o = order([latte, sandwich, water]);
    expect(linesAt(o, "bar").map(l => l.name)).toEqual(["Latte"]);
    expect(linesAt(o, "kitchen").map(l => l.name)).toEqual(["Sándwich"]);
    expect(linesAt(o, null)).toHaveLength(3);
    expect(inStation(order([sandwich]), "bar")).toBe(false);
    expect(inStation(order([sandwich]), null)).toBe(true);
  });

  it("put the order in a station's ready column once that station is done, whatever the other is doing", () => {
    const o = order([latte, sandwich], { stations_ready: ["bar"] });
    expect(viewStatus(o, "bar")).toBe("ready");
    expect(viewStatus(o, "kitchen")).toBe("preparing");
    expect(viewStatus(o, null)).toBe("preparing");
    expect(viewStatus({ ...o, status: "completed" }, "bar")).toBe("completed");
  });
});

describe("the kitchen ticket", () => {
  const t = (key: string) => ({ "ticket.stationBar": "BARRA", "ticket.stationKitchen": "COCINA" }[key] ?? key);
  const place = { name: "Café", timeZone: "America/Mexico_City" };

  it("prints each station's lines under its name when the order needs both, the bar first", () => {
    const text = kitchenTicket(order([sandwich, latte]), place, t);
    expect(text.indexOf("[ BARRA ]")).toBeGreaterThan(-1);
    expect(text.indexOf("[ BARRA ]")).toBeLessThan(text.indexOf("1 x Latte"));
    expect(text.indexOf("1 x Latte")).toBeLessThan(text.indexOf("[ COCINA ]"));
    expect(text.indexOf("[ COCINA ]")).toBeLessThan(text.indexOf("1 x Sándwich"));
  });

  it("prints as before when one station makes everything", () => {
    expect(kitchenTicket(order([sandwich]), place, t)).not.toMatch(/\[ (BARRA|COCINA) \]/);
  });
});
