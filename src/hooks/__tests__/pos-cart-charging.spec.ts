import { afterEach, beforeEach, expect, it, vi } from "vitest";

const set = vi.hoisted(() => vi.fn());
vi.mock("react", () => ({
  useEffect: (fn: () => void) => fn(),
  useRef: (v: unknown) => ({ current: v }),
  useState: (v: unknown) => [v, set],
}));
const { usePosCart } = await import("@/hooks/usePosCart");
let store: Map<string, string>;
beforeEach(() => {
  set.mockReset(); store = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());
const line = { itemId: "tacos", name: "Tacos", emoji: "🌮", price: 50, qty: 1, mods: {}, cartId: 1 };

it("does not restore a cart whose sale was being charged when the page went away (C1)", () => {
  store.set("tt-pos-cart:r1", JSON.stringify([line]));
  store.set("tt-pos-cart:r1:charging", "sale-ref");
  usePosCart("r1");
  expect(set).not.toHaveBeenCalledWith([line]);
  expect(store.has("tt-pos-cart:r1")).toBe(false);
  expect(store.has("tt-pos-cart:r1:charging")).toBe(false);
});

it("restores an ordinary unfinished cart", () => {
  store.set("tt-pos-cart:r1", JSON.stringify([line]));
  usePosCart("r1");
  expect(set).toHaveBeenCalledWith([line]);
});
