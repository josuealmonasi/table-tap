import React, { type ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { contexts, harness } from "./s23b-hook-harness";
import { field, nodes, type Props } from "./s23-test-helpers";
import type { Restaurant } from "@/lib/types";
const mocks = vi.hoisted(() => ({ editor: { loadFailed: true, loading: false, hasLoaded: true, menus: [{ id: "m", name: "Lunch" }], sections: [], products: [], addons: [], links: {}, reload: vi.fn() } }));
vi.mock("react", async original => ({ ...await original<typeof React>(),
  ...await import("./s23b-hook-harness").then(h => ({ useState: h.useState, useRef: h.useRef, useContext: h.useContext, useEffect: h.useEffect, useLayoutEffect: h.useEffect })),
}));
vi.mock("react-dom", () => ({ createPortal: (children: React.ReactNode) => children }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/hooks/useMenuEditor", () => ({ useMenuEditor: () => mocks.editor }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import MenuEditor from "@/components/dashboard/menu/MenuEditor";
import { Modal } from "@/components/ui/Modal";
import ProductForm from "@/components/dashboard/menu/ProductForm";
import ProductStockFields from "@/components/dashboard/menu/ProductStockFields";

beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("document", { body: {} }); contexts.clear(); mocks.editor.loadFailed = true; mocks.editor.reload.mockReset(); });
function recovery() {
  const editor = harness().render(() => MenuEditor({ restaurant: { id: "r", currency: "MXN" } as Restaurant, menuId: "m", menuName: "Lunch" }));
  const provider = nodes(editor).find(n => n.value && typeof n.value === "object" && "blocked" in n.value);
  expect(provider, "the active dialog must receive the menu recovery action").toBeDefined();
  contexts.set(provider!.tag, provider!.value);
  return provider!.value as { blocked: boolean; notice: ReactElement<Props> | null };
}
it("4 / Q4: Retry stays inside the active modal, outside its disabled draft", async () => {
  const value = recovery();
  const modal = harness().render(() => Modal({ open: true, onClose: vi.fn(), children: <input defaultValue={"a".repeat(200)} /> }));
  const body = field(modal, "role", "dialog");
  expect(nodes(body.children)).toContainEqual(expect.objectContaining({ tag: value.notice!.type }));
  const disabled = field(modal, "tag", "fieldset");
  expect(disabled.disabled).toBe(true);
  expect(nodes(disabled.children).some(n => n.tag === value.notice!.type)).toBe(false);
  const Notice = value.notice!.type as (props: Props) => ReactElement;
  const notice = harness().render(() => Notice(value.notice!.props));
  await field(notice, "tag", "button").onClick();
  expect(mocks.editor.reload).toHaveBeenCalledOnce();
});
it("4 / Q4: the draft keeps the same modal subtree through failure and successful retry", () => {
  const frame = harness(); const draft = <input defaultValue={"a".repeat(200)} />;
  recovery();
  const failed = frame.render(() => Modal({ open: true, onClose: vi.fn(), children: draft }));
  mocks.editor.loadFailed = false; recovery();
  const recovered = frame.render(() => Modal({ open: true, onClose: vi.fn(), children: draft }));
  expect(field(failed, "tag", "fieldset").children).toBe(draft);
  expect(field(recovered, "tag", "fieldset").children).toBe(draft);
  expect(field(recovered, "tag", "fieldset").disabled).toBe(false);
});
it("4 / Q4: the 200-character draft and recount of 5 survive a refused save and two retries", async () => {
  const form = harness(); const close = vi.fn(); const submit = vi.fn().mockRejectedValue(new Error("Stock changed"));
  const props = { restaurantId: "r", initial: { id: "dish", name: "Dish", stock: 10, stock_epoch: 0 }, addons: [], currency: "MXN", submitLabel: "Save", inventoryAllowed: true, onSubmit: submit, onCancel: close };
  const render = () => form.render(() => ProductForm(props));
  const initial = render(); form.effects();
  field(initial, "tag", "textarea").onChange({ target: { value: "a".repeat(200) } });
  (field(initial, "tag", ProductStockFields).onStock as (value: string) => void)("5");
  let draft = render(); form.effects();
  await field(draft, "tag", "form").onSubmit({ preventDefault() {} });
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ description: "a".repeat(200), stock: 5, expectedStock: 10 }), []);
  props.initial.stock = 9;
  for (const failed of [true, true, false]) {
    mocks.editor.loadFailed = failed; recovery();
    draft = render(); form.effects();
    expect(field(draft, "tag", "textarea").value).toBe("a".repeat(200));
    expect(field(draft, "tag", ProductStockFields).stock).toBe("5");
  }
  expect(close).not.toHaveBeenCalled();
});
