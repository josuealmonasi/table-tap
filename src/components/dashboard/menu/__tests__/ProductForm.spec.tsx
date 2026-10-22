import { beforeEach, expect, it, vi } from "vitest";
import React, { type ReactElement } from "react";
import type { MenuItem } from "@/lib/types";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.values)) hooks.values[slot] = initial;
    return [hooks.values[slot], (next: unknown) => { hooks.values[slot] = next; }];
  },
}));
vi.mock("@/hooks/useDirtyClose", () => ({ useDirtyClose: (_dirty: boolean, close: () => void) => close }));
vi.mock("@/hooks/useDirty", () => ({ useDirty: () => true }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
const { default: ProductForm } = await import("../ProductForm");
const { default: ProductStockFields } = await import("../ProductStockFields");
const submit = vi.fn();
const initial = { id: "p", name: "Dish", price: 12, stock: 10, stock_epoch: 2 } as Partial<MenuItem>;
function render(item: Partial<MenuItem> | undefined = initial, inventoryAllowed = true) {
  hooks.cursor = 0;
  return ProductForm({ restaurantId: "r", initial: item, inventoryAllowed, addons: [], currency: "MXN", submitLabel: "Save", onSubmit: submit, onCancel: () => {} });
}
async function save(form: ReactElement) {
  await (form.props as { onSubmit: (e: { preventDefault: () => void }) => Promise<void> }).onSubmit({ preventDefault: () => {} });
}
function stockField(form: ReactElement) {
  const children = (form.props as { children: ReactElement[] }).children;
  return children.find(child => child.type === ProductStockFields)!.props as { onStock: (value: string) => void };
}
beforeEach(() => { vi.stubGlobal("React", React); hooks.cursor = 0; hooks.values = []; submit.mockReset(); });
it("J5: omits an unchanged count when saving a dish", async () => {
  await save(render());
  expect(submit.mock.calls[0][0]).not.toHaveProperty("stock");
  expect(submit.mock.calls[0][0]).not.toHaveProperty("expectedStock");
});
it("keeps the opening count and epoch when the row refreshes during editing", async () => {
  stockField(render()).onStock("5");
  await save(render({ ...initial, stock: 7, stock_epoch: 3 }));
  expect(submit.mock.calls[0][0]).toMatchObject({ stock: 5, expectedStock: 10, expectedEpoch: 2 });
});
it("does not turn off tracking when the plan no longer offers the stock field", async () => {
  await save(render(initial, false));
  expect(submit.mock.calls[0][0]).not.toHaveProperty("stock");
});
it("keeps an initial count when creating a new dish", async () => {
  stockField(render(undefined)).onStock("5");
  // Pass a form without an initial dish; the default argument above is for edits.
  hooks.cursor = 0;
  const form = ProductForm({ restaurantId: "r", inventoryAllowed: true, addons: [], currency: "MXN", submitLabel: "Add", onSubmit: submit, onCancel: () => {} });
  await save(form);
  expect(submit.mock.calls[0][0].stock).toBe(5);
  expect(submit.mock.calls[0][0]).not.toHaveProperty("expectedStock");
});
