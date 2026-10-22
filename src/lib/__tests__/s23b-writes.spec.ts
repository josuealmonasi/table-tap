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
  return { ...base, w: makeWriter(base as unknown as EditorContext) } as unknown as EditorContext;
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
  expect(await ctx.w.move("write.reorderExtras", "menu_items", [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], "a", "down")).toBe(false);
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
it.each(failures)("5 / Q8: zero-row or refused schedule and switches roll back their optimistic state: %j", async result => {
  query(result); const ctx = context(); const menus = menuActions(ctx);
  expect(await menus.setMenuSchedule("m", { days: [] } as never)).toBe(false);
  expect(ctx.setMenus).toHaveBeenLastCalledWith(ctx.menus);
  await menus.setMenuActive("m", false); expect(ctx.setMenus).toHaveBeenLastCalledWith(ctx.menus);
  await addonActions(ctx).setAvailability("extra", false); expect(ctx.setAddons).toHaveBeenLastCalledWith(ctx.addons);
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
  expect(await context().w.move("write.reorderExtras", "menu_items", [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], "a", "down")).toBe(false);
});
it("5 / Q8: both returned reorder ids confirm, and an exact count can confirm a bulk write", async () => {
  query({ data: [{ id: "a" }], error: null });
  expect(await context().w.move("write.reorderExtras", "menu_items", [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }], "a", "down")).toBe(true);
  query({ data: null, count: 2, error: null });
  expect(await addonActions(context()).deleteItems(["a", "b"])).toBe(true);
});
it.each(failures)("5 / Q8: a duplicate cannot announce success when its extras did not land: %j", async result => {
  query(result); const ctx = context();
  ctx.products = [{ id: "dish", name: "Dish", menu_id: "m" }] as EditorContext["products"];
  ctx.links = { dish: ["extra"] }; ctx.w.insertReturningId = vi.fn().mockResolvedValue("copy");
  expect(await productActions(ctx).duplicateProduct("dish")).toBeUndefined();
  expect(mocks.toast).not.toHaveBeenCalledWith("done.productDuplicated");
  expect(mocks.toast).toHaveBeenCalledWith("write.updateProductExtras", "error");
});
