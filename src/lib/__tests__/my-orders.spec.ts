import { beforeEach, describe, expect, it, vi } from "vitest";
import { myOrderIds, rememberMyOrder } from "@/lib/my-orders";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  // This module asks whether it is in a browser before it touches storage —
  // it is imported by server components too — so the test has to look like
  // one. Without this it returns an empty list whatever is stored, and every
  // assertion below passes for the wrong reason.
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});

/**
 * There are no diner accounts, so this list is the only thing separating "my
 * food" from "the rest of the table" when a bill is divided.
 */
describe("the orders this phone placed", () => {
  it("starts empty and remembers in the order they were placed", () => {
    expect(myOrderIds("r1")).toEqual([]);
    rememberMyOrder("r1", "a");
    rememberMyOrder("r1", "b");
    expect(myOrderIds("r1")).toEqual(["a", "b"]);
  });

  it("does not record the same order twice", () => {
    rememberMyOrder("r1", "a");
    rememberMyOrder("r1", "a");
    expect(myOrderIds("r1")).toEqual(["a"]);
  });

  it("keeps one restaurant's orders out of another's", () => {
    rememberMyOrder("r1", "a");
    rememberMyOrder("r2", "b");
    expect(myOrderIds("r1")).toEqual(["a"]);
    expect(myOrderIds("r2")).toEqual(["b"]);
  });

  it("stops growing on a regular's phone", () => {
    for (let i = 0; i < 60; i++) rememberMyOrder("r1", `o${i}`);
    const kept = myOrderIds("r1");
    expect(kept).toHaveLength(40);
    // The newest are the ones a visit needs; the oldest fall off.
    expect(kept.at(-1)).toBe("o59");
    expect(kept).not.toContain("o0");
  });

  it("ignores anything else that wrote to the key", () => {
    store.set("tt:orders:r1", '"not an array"');
    expect(myOrderIds("r1")).toEqual([]);
    store.set("tt:orders:r1", "{ broken json");
    expect(myOrderIds("r1")).toEqual([]);
    store.set("tt:orders:r1", '["a", 7, null, "b"]');
    expect(myOrderIds("r1")).toEqual(["a", "b"]);
  });

  it("loses only the option to pay for its own when storage is off", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    expect(myOrderIds("r1")).toEqual([]);
    expect(() => rememberMyOrder("r1", "a")).not.toThrow();
  });
});
