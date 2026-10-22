import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
const mock = vi.hoisted(() => ({ actor: vi.fn(), frozen: vi.fn(), plan: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingManager: mock.actor }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: mock.frozen, planBlocks: mock.plan }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ from: mock.from }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
import { PATCH } from "../route";
const restaurant = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const extra = "00000000-0000-4000-8000-000000000003";
const menu = "00000000-0000-4000-8000-000000000004";
const send = (body: object) => PATCH(new NextRequest("http://test/api/products", { method: "PATCH", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks(); mock.actor.mockResolvedValue({ restaurantId: restaurant });
  mock.frozen.mockResolvedValue(null); mock.plan.mockResolvedValue(null); mock.rpc.mockResolvedValue({ data: id, error: null });
});
it("K11: fields and extras go through one scoped write before confirmation", async () => {
  const res = await send({ id, restaurantId: "forged", changes: { description: "New", stock: 100, restaurant_id: "forged" }, addonIds: [extra] });
  expect(res.status).toBe(200); expect(mock.from).not.toHaveBeenCalled();
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_product_addons_v1", { p_restaurant: restaurant, p_product: id, p_addons: [extra], p_changes: { description: "New" }, p_menu: null, p_category: null });
});
it("K11: a failed extras write cannot report success", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { message: "insert refused" } });
  expect((await send({ id, changes: { price: 100 }, addonIds: [extra] })).status).toBe(503);
  expect(mock.from).not.toHaveBeenCalled();
});
it("K11: a missing or foreign dish is not a successful empty write", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: null });
  expect((await send({ id, addonIds: [] })).status).toBe(404);
});
it("K11: creation also commits its extras before returning the new id", async () => {
  const res = await send({ menuId: menu, categoryId: null, changes: { name: "Taco", price: 100, stock: 5 }, addonIds: [extra] });
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ ok: true, id });
  expect(mock.plan).toHaveBeenCalledWith(restaurant, "inventory");
  expect(mock.rpc).toHaveBeenCalledWith("save_product_addons_v1", expect.objectContaining({ p_product: null, p_menu: menu, p_changes: { name: "Taco", price: 100, stock: 5 } }));
});
it.each([{ id, addonIds: [extra, extra] }, { id, addonIds: ["bad"] }, { id: "bad", menuId: menu, addonIds: [] }, { menuId: menu, categoryId: "bad", addonIds: [] }])("K11: refuses malformed replacements before writing", async body => {
  expect((await send(body)).status).toBe(400); expect(mock.rpc).not.toHaveBeenCalled();
});
it("K11: manager, frozen and stock-plan guards apply before the private transaction", async () => {
  mock.actor.mockResolvedValue(null); expect((await send({ id, addonIds: [] })).status).toBe(403);
  mock.actor.mockResolvedValue({ restaurantId: restaurant });
  mock.frozen.mockResolvedValue(NextResponse.json({}, { status: 403 })); expect((await send({ id, addonIds: [] })).status).toBe(403);
  mock.frozen.mockResolvedValue(null); mock.plan.mockResolvedValue(NextResponse.json({}, { status: 403 }));
  expect((await send({ menuId: menu, changes: { stock: 5 }, addonIds: [] })).status).toBe(403);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("K11: the private SQL scopes, locks and replaces without swallowing an insert failure", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const sql = schema.slice(schema.indexOf("create or replace function public.save_product_addons_v1("));
  expect(sql).toContain("security definer set search_path = public");
  expect(sql).toContain("restaurant_id = p_restaurant and not is_addon for update");
  expect(sql).toContain("menu_id is not distinct from v_product.menu_id and is_addon");
  expect(sql.indexOf("delete from item_addons")).toBeLessThan(sql.indexOf("insert into item_addons"));
  expect(sql).not.toMatch(/exception\s+when/i);
  expect(sql).toContain("from public, anon, authenticated"); expect(sql).toContain("to service_role");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("save_product_addons_v1(uuid, uuid, uuid[], jsonb, uuid, uuid)");
});
it("K11: the transaction's late plan refusals keep their useful explanation", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { message: "tt_plan_limit items carta 30" } });
  const limit = await send({ menuId: menu, changes: { name: "Dish", price: 10 }, addonIds: [] });
  expect(limit.status).toBe(403); expect(await limit.json()).toEqual({ error: "plan.limit.items" });
  mock.rpc.mockResolvedValue({ data: null, error: { message: "tt_plan_frozen" } });
  const frozen = await send({ id, addonIds: [] });
  expect(frozen.status).toBe(402); expect(await frozen.json()).toEqual({ error: "plan.frozen" });
});
