import { describe, expect, it } from "vitest";
import type { Category, MenuItem } from "@/lib/types";
import { posSectionId, posSections } from "@/lib/pos-sections";

const cat = (id: string, name: string) => ({ id, name }) as Category;
const dish = (id: string, category_id: string, name: string, available = true) =>
  ({ id, category_id, name, available }) as MenuItem;

describe("the till's sections", () => {
  const categories = [cat("c1", "Starters"), cat("c2", "Mains"), cat("c3", "starters "), cat("c4", "Empty")];
  const items = [
    dish("d1", "c1", "Soup"),
    dish("d2", "c2", "Steak"),
    dish("d3", "c3", "Salad", false),
  ];

  it("is one section per heading name, whichever menu each came from", () => {
    expect(posSections(categories, items, "").map(s => [s.name, s.dishes.map(d => d.id)])).toEqual([
      ["Starters", ["d1", "d3"]],
      ["Mains", ["d2"]],
    ]);
  });

  it("keeps a sold-out dish, so the cashier can say it has run out", () => {
    expect(posSections(categories, items, "").flatMap(s => s.dishes).some(d => d.id === "d3")).toBe(true);
  });

  it("narrows to what was typed and drops sections left empty", () => {
    expect(posSections(categories, items, "  STE ").map(s => s.name)).toEqual(["Mains"]);
    expect(posSections(categories, items, "zzz")).toEqual([]);
  });

  it("gives each heading an id a chip can jump to", () => {
    expect(posSectionId(" Platos Fuertes! ")).toBe("pos-platos-fuertes-");
  });
});
