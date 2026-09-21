import { beforeEach, describe, expect, it, vi } from "vitest";
import { dinerToken, forgetDiner } from "@/lib/diner-token";

/** Plain Node, so the one browser API this module uses is stood up by hand. */
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("the name a phone gives itself for the evening", () => {
  it("keeps the same one all night", () => {
    // A diner has no login, so this is the only thing telling one seat from
    // another. Handing out a new one mid-meal loses their share of the bill.
    const first = dinerToken("r1");
    expect(first).not.toBe("");
    expect(dinerToken("r1")).toBe(first);
    expect(dinerToken("r1")).toBe(first);
  });

  it("does not carry a seat from one restaurant to another", () => {
    // A phone that ate somewhere else last week must not arrive holding a
    // seat at tonight's table.
    expect(dinerToken("r1")).not.toBe(dinerToken("r2"));
  });

  it("gives two phones different names", () => {
    const a = dinerToken("r1");
    store.clear();
    const b = dinerToken("r1");
    expect(a).not.toBe(b);
  });

  it("forgets one restaurant without forgetting the other", () => {
    const kept = dinerToken("r2");
    const dropped = dinerToken("r1");
    forgetDiner("r1");
    expect(dinerToken("r2")).toBe(kept);
    expect(dinerToken("r1")).not.toBe(dropped);
  });

  it("answers nothing when the phone has storage switched off", () => {
    // Every split route refuses an empty diner, so such a phone can read the
    // bill and simply cannot hold a seat — which is better than throwing on
    // the screen somebody is paying from. Two of them must not collide on ""
    // and end up sharing a share.
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(dinerToken("r1")).toBe("");
    expect(() => forgetDiner("r1")).not.toThrow();
  });
});
