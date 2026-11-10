import { expect, it, vi } from "vitest";

vi.mock("react", () => ({ useEffect: vi.fn(), useRef: vi.fn(), useState: vi.fn() }));
const { sameChoice } = await import("@/hooks/useCart");

const combo = (milk: string) => ({
  itemId: "combo", comboId: "c1", name: "Coffee combo", emoji: "☕", price: 90, qty: 1, mods: {},
  components: [{ itemId: "latte", name: "Latte", emoji: "☕", qty: 1, mods: { Milk: milk } },
    { itemId: "bun", name: "Bun", emoji: "🥐", qty: 1 }],
});

it("keeps an oat-milk combo and a whole-milk combo apart (journey A, finding 1)", () => {
  expect(sameChoice(combo("Oat"), combo("Whole"))).toBe(false);
  expect(sameChoice(combo("Oat"), combo("Oat"))).toBe(true);
});

it("treats the same choices in another order as the same plate", () => {
  const a = { itemId: "d", name: "x", emoji: "x", price: 1, qty: 1, mods: { A: "1", B: ["y", "x"] }, extras: [{ id: "e2" }, { id: "e1" }] };
  const b = { ...a, mods: { B: ["x", "y"], A: "1" }, extras: [{ id: "e1" }, { id: "e2" }] };
  expect(sameChoice(a as never, b as never)).toBe(true);
});
