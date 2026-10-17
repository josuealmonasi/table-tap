import { beforeEach, describe, expect, it, vi } from "vitest";
import { dropHeld, holdSale, markHeldError, readHeld, type HeldSale } from "@/lib/offline-sales";

const store = new Map<string, string>();
const writes: string[] = [];
const sale = (posRef: string, total = 100): HeldSale => ({
  posRef, restaurantId: "r", at: "2026-10-17T01:00:00.000Z", method: "cash", items: [],
  charge: { subtotal: total, serviceFee: 0, tip: 0, discount: 0, total },
});

beforeEach(() => {
  store.clear();
  writes.length = 0;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); store.set(k, v); },
    removeItem: (k: string) => store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  });
});

describe("held sales on a tablet with two till tabs", () => {
  it("holding a sale writes that sale's key and nothing else", () => {
    holdSale(sale("a"));
    holdSale(sale("b", 200));
    expect(writes).toEqual(["tt-offline-sale:r:a", "tt-offline-sale:r:b"]);
    expect(readHeld().map(s => s.posRef).sort()).toEqual(["a", "b"]);
  });

  it("a sale survives another tab rewriting the old shared list", () => {
    expect(holdSale(sale("a"))).toBe(true);
    // A tab still running the code from before saves its own sale over the list it read.
    store.set("tt-offline-sales", JSON.stringify([sale("old", 50)]));
    expect(readHeld().map(s => s.posRef).sort()).toEqual(["a", "old"]);
  });

  it("reads the old list's sales, marks and drops them one at a time", () => {
    store.set("tt-offline-sales", JSON.stringify([sale("x"), sale("y", 40)]));
    markHeldError("x", "r", "refused");
    expect(readHeld().find(s => s.posRef === "x")?.error).toBe("refused");
    expect(readHeld()).toHaveLength(2);
    expect(dropHeld("x", "r")).toBe(true);
    expect(readHeld().map(s => s.posRef)).toEqual(["y"]);
    expect(dropHeld("y", "r")).toBe(true);
    expect(readHeld()).toEqual([]);
    expect(store.has("tt-offline-sales")).toBe(false);
  });

  it("keeps a sale per restaurant: the same reference in two restaurants is two sales", () => {
    holdSale(sale("a"));
    holdSale({ ...sale("a"), restaurantId: "r2" });
    expect(readHeld()).toHaveLength(2);
    dropHeld("a", "r2");
    expect(readHeld().map(s => s.restaurantId)).toEqual(["r"]);
  });
});
