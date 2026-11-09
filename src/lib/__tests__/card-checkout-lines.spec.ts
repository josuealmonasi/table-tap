import { beforeEach, expect, it, vi } from "vitest";
import { rememberCardLines, takePaidCardLines } from "@/lib/card-checkout-lines";
import type { CartItem } from "@/hooks/useCart";

const store = new Map<string, string>();
const latte: CartItem = { cartId: 1, itemId: "latte", name: "Latte", emoji: "☕", price: 60, qty: 2, mods: {} };

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});

it("A4 hands back the lines a paid card order took, once", () => {
  rememberCardLines("r", "order-1", [latte]);
  expect(takePaidCardLines("r", "order-1")).toEqual([latte]);
  expect(takePaidCardLines("r", "order-1")).toBeNull();
});

it("A4 keeps the cart of an abandoned checkout when another order comes back paid", () => {
  rememberCardLines("r", "order-2", [latte]);
  expect(takePaidCardLines("r", "order-1")).toBeNull();
  expect(takePaidCardLines("r", "order-2")).toEqual([latte]);
});

it("A4 keeps restaurants apart", () => {
  rememberCardLines("r", "order-1", [latte]);
  expect(takePaidCardLines("other", "order-1")).toBeNull();
});
