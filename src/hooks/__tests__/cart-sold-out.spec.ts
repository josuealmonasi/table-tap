import { expect, it, vi } from "vitest";

vi.mock("react", () => ({ useMemo: (fn: () => unknown) => fn(), useState: <T,>(v: T) => [v, vi.fn()] }));
const { useCartTotals } = await import("@/hooks/useCartTotals");

const line = { itemId: "tacos", name: "Tacos", emoji: "🌮", price: 50, qty: 1, mods: {}, cartId: 1 };
const cart = { items: [line] } as never;
const restaurant = { service_pct: 0, service_enabled: false };
const dish = { id: "tacos", name: "Tacos", price: 50 } as never;

it("greys out a dish the menu dropped, and lets it back when it returns (journey A, finding 6)", () => {
  const gone = useCartTotals(cart, [], restaurant, []);
  expect(gone.soldOut.has("tacos")).toBe(true);
  expect(gone.orderableItems).toHaveLength(0);
  const back = useCartTotals(cart, [dish], restaurant, []);
  expect(back.soldOut.has("tacos")).toBe(false);
  expect(back.orderableItems).toHaveLength(1);
});
