import { beforeEach, expect, it, vi } from "vitest";
import { productActions } from "../products";
import { menuActions } from "../menus";
import type { EditorContext } from "../types";

const update = vi.fn();
const request = vi.fn();
const run = vi.fn(async (_key, query) => { await query; });
const ctx = {
  ready: () => true, restaurantId: "r", products: [{ id: "p", stock: 10, stock_epoch: 0 }], sections: [], links: {},
  supabase: { from: () => ({ update: (input: unknown) => {
    update(input); return { eq: async () => ({ error: null }) };
  } }) },
  reload: vi.fn(), toast: vi.fn(), t: (key: string) => key,
  w: { run, reportError: vi.fn(), insertReturningId: vi.fn() },
} as unknown as EditorContext;
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", request); request.mockResolvedValue(Response.json({ ok: true })); });

it("J5: saving a description never writes the stale stock in an ordinary update", async () => {
  await productActions(ctx).updateProduct("p", { description: "New description", stock: 10 });
  expect(update.mock.calls.every(([input]) => !("stock" in input))).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ id: "p", changes: { description: "New description" } });
});

it("sends a deliberate count separately, with exactly the values the form saw", async () => {
  await productActions(ctx).updateProduct("p", { description: "New", stock: 5, expectedStock: 10, expectedEpoch: 0 });
  expect(request.mock.calls.map(([, init]) => [init.method, JSON.parse(init.body)])).toEqual([
    ["POST", { id: "p", stock: 5, expectedStock: 10, expectedEpoch: 0 }],
    ["PATCH", { id: "p", changes: { description: "New" } }],
  ]);
});
it("surfaces a refused recount and does not continue the save", async () => {
  request.mockResolvedValue(Response.json({ error: "The count changed" }, { status: 409 }));
  await expect(productActions(ctx).updateProduct("p", { description: "New", stock: 5, expectedStock: 10, expectedEpoch: 0 })).rejects.toThrow("The count changed");
  expect(request).toHaveBeenCalledTimes(1);
  expect(ctx.toast).toHaveBeenCalledWith("The count changed", "error");
  expect(ctx.reload).toHaveBeenCalled();
});
it("J17: does not edit or duplicate before the complete state is ready", async () => {
  const loading = { ...ctx, ready: () => false };
  await expect(productActions(loading).updateProduct("p", { description: "New" })).rejects.toThrow("Menu has not loaded");
  expect(await productActions(loading).duplicateProduct("p")).toBeUndefined();
  expect(await menuActions(loading).duplicateMenu("m")).toBeUndefined();
  expect(request).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
});
