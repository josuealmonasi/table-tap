import { beforeEach, expect, it, vi } from "vitest";
import { harness } from "./s23b-hook-harness";
import type { EditorContext } from "@/hooks/menu-editor/types";
const mocks = vi.hoisted(() => ({ from: vi.fn(), toast: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), ...await import("./s23b-hook-harness").then(h => ({ useState: h.useState })) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: mocks.from }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { makeWriter } from "@/hooks/menu-editor/writer";
import { addonActions } from "@/hooks/menu-editor/addons";
import { menuActions } from "@/hooks/menu-editor/menus";
import { importActions } from "@/hooks/menu-editor/import";
import { productActions } from "@/hooks/menu-editor/products";
import { useTables } from "@/hooks/useTables";

const reload = vi.fn();
type Result = { data: { id: string }[] | null; error: { message: string } | null; count?: number | null };
function query(result: Result) {
  const chain = {
    insert: vi.fn(() => chain), update: vi.fn(() => chain), delete: vi.fn(() => chain), eq: vi.fn(() => chain), in: vi.fn(() => chain),
    select: vi.fn(() => chain), single: vi.fn(async () => ({ ...result, data: result.data?.[0] ?? null })),
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  mocks.from.mockReturnValue(chain);
  return chain;
}
function context() {
  const base = { supabase: { from: mocks.from }, restaurantId: "r", toast: mocks.toast, t: (key: string) => key, reload, ready: async () => true,
    menus: [{ id: "m", active: true, schedule: null, sort_order: 0 }], sections: [], products: [], addons: [{ id: "extra", price: 5, available: true }], links: {},
    setMenus: vi.fn(), setProducts: vi.fn(), setAddons: vi.fn(),
  };
  const latest = { current: { menus: base.menus, sections: base.sections, products: base.products, addons: base.addons, links: base.links } };
  return { ...base, latest, w: makeWriter({ ...base, latest } as unknown as EditorContext) } as unknown as EditorContext;
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
const failures: Result[] = [{ data: [], error: null, count: 0 }, { data: null, error: { message: "refused" } }];
it.each(failures)("5 / Q8: MXN 5→MXN 10 extra update refuses zero rows or an explicit error: %j", async result => {
  const chain = query(result); const ctx = context();
  expect(await addonActions(ctx).updateAddon("extra", { price: 10 })).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith("write.updateExtra", "error");
  expect(mocks.toast).not.toHaveBeenCalledWith("done.extraUpdated"); expect(reload).not.toHaveBeenCalled();
  if (!result.error) expect(chain.select).toHaveBeenCalledWith("id");
});
it("5 / Q8: a returned extra id confirms the write", async () => {
  query({ data: [{ id: "extra" }], error: null });
  expect(await addonActions(context()).updateAddon("extra", { price: 10 })).toBe(true);
  expect(mocks.toast).toHaveBeenCalledWith("done.extraUpdated"); expect(reload).toHaveBeenCalledOnce();
});
it.each(failures)("5 / Q8: reorder refuses a missing or refused sibling: %j", async result => {
  query(result); const ctx = context();
  expect(await ctx.w.move("write.reorderExtras", "menu_items", () => [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], "a", "down")).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith("write.reorderExtras", "error");
});
it.each(failures)("5 / Q8: table 7→8 keeps the edit after zero rows or an explicit error: %j", async result => {
  const chain = query(result);
  expect(await harness().render(() => useTables("r")).renameTable("table", "8")).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith("write.renameTable", "error"); expect(mocks.refresh).not.toHaveBeenCalled();
  if (!result.error) expect(chain.select).toHaveBeenCalledWith("id");
});
it("5 / Q8: table rename refreshes only after a returned id", async () => {
  query({ data: [{ id: "table" }], error: null });
  expect(await harness().render(() => useTables("r")).renameTable("table", "8")).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it.each(failures)("5 / Q8 + L7: zero-row or refused schedule and switches roll back by reading what is saved: %j", async result => {
  // Not by putting back the arrays they were called with: those predate the
  // read `ready` waited for, and restoring them undid that read.
  query(result); const ctx = context(); const menus = menuActions(ctx);
  expect(await menus.setMenuSchedule("m", { days: [] } as never)).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
  await menus.setMenuActive("m", false); expect(reload).toHaveBeenCalledTimes(2);
  await addonActions(ctx).setAvailability("extra", false); expect(reload).toHaveBeenCalledTimes(3);
  expect(ctx.setMenus).not.toHaveBeenCalledWith(ctx.menus);
  expect(ctx.setAddons).not.toHaveBeenCalledWith(ctx.addons);
});
it("5 / Q8: an insert without its new id never announces success", async () => {
  query(failures[0]);
  expect(await context().w.insertReturningId("write.createMenu", "menus", {}, "done.menuAdded")).toBeUndefined();
  expect(mocks.toast).not.toHaveBeenCalledWith("done.menuAdded"); expect(reload).not.toHaveBeenCalled();
});
it("5 / Q8: a zero-row import cannot claim a dish was added", async () => {
  query(failures[0]);
  expect(await importActions(context()).importRows("m", [{ line: 1, name: "Dish", price: 10, category: null, description: "", emoji: "" }])).toBe(0);
  expect(mocks.toast).toHaveBeenCalledWith("write.importMenu", "error");
});
it("5 / Q8: a bulk delete cannot confirm after changing only one of two rows", async () => {
  query({ data: [{ id: "a" }], error: null });
  expect(await addonActions(context()).deleteItems(["a", "b"])).toBe(false);
});
it("5 / Q8: a partial reorder cannot confirm even when the other sibling changed", async () => {
  const first = query({ data: [{ id: "a" }], error: null }); const second = query(failures[0]);
  mocks.from.mockReturnValueOnce(first).mockReturnValueOnce(second);
  expect(await context().w.move("write.reorderExtras", "menu_items", () => [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], "a", "down")).toBe(false);
});
it("5 / Q8: both returned reorder ids confirm, and an exact count can confirm a bulk write", async () => {
  query({ data: [{ id: "a" }], error: null });
  expect(await context().w.move("write.reorderExtras", "menu_items", () => [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], "a", "down")).toBe(true);
  query({ data: null, count: 2, error: null });
  expect(await addonActions(context()).deleteItems(["a", "b"])).toBe(true);
});
it.each(failures)("5 / Q8: a duplicate cannot announce success when its extras did not land: %j", async result => {
  query(result); const ctx = context();
  Object.assign(ctx.latest.current, { products: [{ id: "dish", name: "Dish", menu_id: "m" }], links: { dish: ["extra"] } });
  ctx.w.insertReturningId = vi.fn().mockResolvedValue("copy");
  expect(await productActions(ctx).duplicateProduct("dish")).toBeUndefined();
  expect(mocks.toast).not.toHaveBeenCalledWith("done.productDuplicated");
  expect(mocks.toast).toHaveBeenCalledWith("write.updateProductExtras", "error");
});

it("L7: a copy made while a read was landing copies what that read returned", async () => {
  // Pressed with the dish on screen at MX$100 and one extra; the read it waited
  // for had it at MX$150 with two. The copy used to be MX$100 with one.
  query({ data: [{ product_id: "copy" }, { product_id: "copy" }] as never, error: null });
  const ctx = context();
  ctx.products = [{ id: "dish", name: "Dish", menu_id: "m", price: 100, sort_order: 0 }] as EditorContext["products"];
  ctx.links = { dish: ["extra"] };
  Object.assign(ctx.latest.current, {
    products: [{ id: "dish", name: "Dish", menu_id: "m", price: 150, sort_order: 0 }], links: { dish: ["extra", "salsa"] },
  });
  ctx.w.insertReturningId = vi.fn().mockResolvedValue("copy");
  expect(await productActions(ctx).duplicateProduct("dish")).toBe("copy");
  expect(vi.mocked(ctx.w.insertReturningId).mock.calls[0][2]).toMatchObject({ price: 150 });
  const chain = mocks.from.mock.results.at(-1)?.value as { insert: ReturnType<typeof vi.fn> };
  expect(chain.insert.mock.calls[0][0]).toHaveLength(2);
});

it("L7: a reorder swaps the positions the latest read holds, not the ones on screen", async () => {
  query({ data: [{ id: "a" }], error: null });
  const ctx = context();
  // Nothing on screen yet; the read it waited for holds both dishes.
  Object.assign(ctx.latest.current, { products: [
    { id: "a", menu_id: "m", category_id: null, sort_order: 0 },
    { id: "b", menu_id: "m", category_id: null, sort_order: 1 },
  ] });
  await productActions(ctx).moveProduct("a", "down");
  const chain = mocks.from.mock.results.at(-1)?.value as { update: ReturnType<typeof vi.fn> };
  expect(chain.update.mock.calls.map(c => c[0])).toEqual([{ sort_order: 1 }, { sort_order: 0 }]);
});
