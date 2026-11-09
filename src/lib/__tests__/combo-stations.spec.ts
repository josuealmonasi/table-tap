import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verifyCombo } from "@/lib/verify-combo";
import { stationsOf, linesAt } from "@/lib/stations";
import { kitchenTicket } from "@/lib/ticket";
import type { Combo } from "@/lib/promotions";
import type { OrderLineItem } from "@/lib/types";
import type { VerifiableItem } from "@/lib/verify-cart";
const components = [
  { itemId: "food", name: "Toast", emoji: "", qty: 1 },
  { itemId: "drink", name: "Latte", emoji: "", qty: 2 },
  { itemId: "water", name: "Water", emoji: "", qty: 1 },
];
function verified() {
  const products = components.map(part => ({ id: part.itemId, name: part.name, price: 10, modifiers: [], available: true,
    categories: { station: part.itemId === "food" ? "kitchen" : "bar" }, skips_kitchen: part.itemId === "water",
  } as VerifiableItem));
  const result = verifyCombo({ id: "meal", name: "Breakfast", emoji: "", price: 40, components } as Combo,
    { mods: {}, components: components.map(part => ({ ...part, station: "bar", skipsKitchen: true })) } as OrderLineItem,
    3, new Map(products.map(p => [p.id, p])), new Map(), () => true);
  if (!result.ok) throw new Error("Combo rejected");
  return result.line;
}
it("B7: stamps component preparation facts from the menu and keeps one priced line", () => {
  const line = verified();
  expect(line.components?.[1]).toMatchObject({ station: "bar" });
  expect(line.components?.[0].skipsKitchen).not.toBe(true);
  expect(line.components?.[2]).toMatchObject({ skipsKitchen: true });
  expect(line.price).toBe(40); expect(line.qty).toBe(3);
});
it("B7: each station sees its own component under the same combo and bill", () => {
  const order = { items: [verified()] };
  expect(stationsOf(order)).toEqual(["kitchen", "bar"]);
  expect(linesAt(order, "bar")[0]?.components?.map(p => p.name)).toEqual(["Latte"]);
  expect(linesAt(order, "kitchen")[0]?.components?.map(p => p.name)).toEqual(["Toast"]);
  expect(linesAt(order, null)).toBe(order.items);
});
it("B7: the paper routes a mixed combo to both station headings", () => {
  const text = kitchenTicket({ id: "meal", items: [verified()], created_at: "2026-11-09T12:00:00Z" },
    { name: "Cafe", timeZone: "UTC" }, key => key);
  expect(text).toContain("ticket.stationBar"); expect(text).toContain("ticket.stationKitchen");
  expect(text.match(/Latte/g)).toHaveLength(1); expect(text.match(/Toast/g)).toHaveLength(1);
});
it("B7: the station writer computes required stations from components with a legacy parent fallback", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8").split("create or replace function public.mark_station_ready(")[1].split("$$;")[0];
  expect(sql).toContain("then i->'components' else");
  expect(sql).toContain("jsonb_build_array(i)");
  expect(sql).toContain("part->>'skipsKitchen'");
});
