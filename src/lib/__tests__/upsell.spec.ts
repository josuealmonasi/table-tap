import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearUpsell, offeredUpsell, rememberUpsell } from "@/lib/upsell";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});

/**
 * A waiter asks "anything else?" once and the answer stands. Storing only
 * THAT we had asked was the original bug: the strip was cleared on leaving the
 * cart and the flag then refused to let it back, so the question vanished for
 * the rest of the meal. What was offered is stored instead.
 */
describe("what this bill was offered", () => {
  it("says nothing has been offered yet, which is not the same as nothing", () => {
    // null means "ask"; an empty list means "asked, and there was nothing".
    expect(offeredUpsell("r1")).toBeNull();
    rememberUpsell("r1", []);
    expect(offeredUpsell("r1")).toEqual([]);
  });

  it("keeps the same dishes so the strip does not reshuffle under a thumb", () => {
    rememberUpsell("r1", ["a", "b", "c"]);
    expect(offeredUpsell("r1")).toEqual(["a", "b", "c"]);
    expect(offeredUpsell("r1")).toEqual(["a", "b", "c"]);
  });

  it("asks the next table afresh", () => {
    rememberUpsell("r1", ["a"]);
    clearUpsell("r1");
    expect(offeredUpsell("r1")).toBeNull();
  });

  it("keeps one restaurant's offer out of another's", () => {
    rememberUpsell("r1", ["a"]);
    expect(offeredUpsell("r2")).toBeNull();
  });

  it("offers afresh when something else wrote the key", () => {
    store.set("tt-upsell:r1", "{ broken");
    expect(offeredUpsell("r1")).toBeNull();
    store.set("tt-upsell:r1", '["a", 7]');
    expect(offeredUpsell("r1")).toBeNull();
  });

  it("does not throw on a phone with storage off", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(offeredUpsell("r1")).toBeNull();
    expect(() => rememberUpsell("r1", ["a"])).not.toThrow();
    expect(() => clearUpsell("r1")).not.toThrow();
  });
});
