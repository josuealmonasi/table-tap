import { describe, expect, it } from "vitest";
import { fetchMenuData } from "@/lib/menu-data";

type Client = Parameters<typeof fetchMenuData>[0];
function client(fail?: string) {
  const pages: string[] = [];
  const rows: Record<string, Record<string, unknown>[]> = {
    menus: [{ id: "m", sort_order: 0 }], categories: [{ id: "c", sort_order: 0 }],
    menu_items: Array.from({ length: 1002 }, (_, n) => ({ id: `p${n}`, sort_order: 0, is_addon: n === 1001 })),
    item_addons: [{ product_id: "p1000", addon_id: "p1001" }],
  };
  return { pages, db: { from: (table: string) => {
    const orders: string[] = [];
    let ids: string[] | undefined;
    const result = (from = 0, to = 999) => ({
      data: rows[table].filter(row => !ids || ids.includes(String(row.product_id))).slice(from, Math.min(to + 1, from + 1000)),
      error: table === fail ? { message: "read failed" } : null,
    });
    const q = { select: () => q, eq: () => q, in: (_column: string, values: string[]) => { ids = values; return q; },
      order: (column: string) => { orders.push(column); return q; },
      range: async (from: number, to: number) => {
        pages.push(`${table}:${from}`);
        expect(orders).toContain(table === "item_addons" ? "addon_id" : "id");
        return result(from, to);
      },
      then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }; return q;
  } } as unknown as Client };
}

describe("J17: the editor has all of the menu or no editable state", () => {
  it("pages tied sort positions and keeps the last product, extra and link", async () => {
    const { db, pages } = client();
    const data = await fetchMenuData(db, "r");
    expect(data.products).toHaveLength(1001);
    expect(data.addons).toHaveLength(1);
    expect(data.links.p1000).toEqual(["p1001"]);
    expect(pages).toContain("menu_items:1000");
  });
  it.each(["menus", "categories", "menu_items", "item_addons"])("throws when %s cannot be read", async table => {
    await expect(fetchMenuData(client(table).db, "r")).rejects.toThrow("read failed");
  });
});
