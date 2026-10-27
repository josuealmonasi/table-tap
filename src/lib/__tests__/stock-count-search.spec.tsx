// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StockView } from "@/lib/costs/stock-server";
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (k: string) => k }));
vi.mock("@/hooks/useWhen", () => ({ useWhen: () => () => "today" }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));
import StockPanel from "@/components/dashboard/costs/StockPanel";
import CountDialog from "@/components/dashboard/costs/CountDialog";
const ingredients = ["Apple", "Milk", "Rice"].map((name, n) => ({ id: name, name, unit: "ml" as const, pack_size: 1000, pack_price: 20, unit_cost: .02, supplier: null, lead_days: n }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function type(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("puts unknown and negative stock before known stock and searches names without changing the source", async () => {
  const stock = { ingredients, onHand: { Apple: 5000, Milk: null, Rice: -1000 }, lastCounts: {} } as unknown as StockView;
  await act(async () => root.render(<StockPanel stock={stock} currency="MXN" />));
  expect([...host.querySelectorAll(".tt-costs-product-name")].map(n => n.textContent)).toEqual(["Milk", "Rice", "Apple"]);
  await type(host.querySelector('input[type="search"]')!, " RICE ");
  expect([...host.querySelectorAll(".tt-costs-product-name")].map(n => n.textContent)).toEqual(["Rice"]);
  expect(ingredients.map(i => i.name)).toEqual(["Apple", "Milk", "Rice"]);
});
it("keeps typed counts visible through searches and retries the same converted payload after a lost reply", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(Response.json({ results: [] })); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CountDialog open ingredients={ingredients} currency="MXN" onClose={vi.fn()} />));
  await type(host.querySelector('input[inputmode="decimal"]')!, "1.5");
  await type(host.querySelector('input[type="search"]')!, "milk");
  expect([...host.querySelectorAll(".tt-costs-count-row")].map(n => n.textContent)).toEqual(["Applecosts.unitShort.l", "Milkcosts.unitShort.l"]);
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(JSON.parse(fetcher.mock.calls[0][1].body).counts).toEqual([{ ingredientId: "Apple", counted: 1500 }]);
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
});
