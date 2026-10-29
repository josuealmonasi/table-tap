import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { forgetDeviceCode, readDeviceCard, rememberCard, rememberDeclined } from "@/lib/loyalty/device";

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it("forgets a deleted card wherever this phone saved it, and nothing else (sweep 3, finding 6)", () => {
  rememberCard("r1", "ABCD2345EFGH");
  rememberCard("r2", "ABCD2345EFGH");
  rememberCard("r3", "ZZZZ2345EFGH");
  rememberDeclined("r4");
  store.set("other", "kept");
  forgetDeviceCode("abcd-2345-efgh");
  expect(readDeviceCard("r1")).toBeNull();
  expect(readDeviceCard("r2")).toBeNull();
  expect(readDeviceCard("r3")).toEqual({ code: "ZZZZ2345EFGH" });
  expect(readDeviceCard("r4")).toEqual({ declined: true });
  expect(store.get("other")).toBe("kept");
});
