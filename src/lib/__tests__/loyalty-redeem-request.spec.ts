import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { forgetRedeemRequest, redeemRequest } from "@/lib/loyalty/redeem-request";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("keeps the displayed round, step and key through a lost response and a new caller", () => {
  const original = redeemRequest("CARD", 0, 2);
  expect(redeemRequest("CARD", 0, 2)).toEqual(original);
  expect(redeemRequest("CARD", 1, 2).requestKey).not.toBe(original.requestKey);
  expect(redeemRequest("CARD", 0, 4).requestKey).not.toBe(original.requestKey);
});
it("forgets only an answered handover, without erasing another tab's key", () => {
  const original = redeemRequest("CARD", 0, 2);
  forgetRedeemRequest({ ...original, requestKey: "another-tab" });
  expect(redeemRequest("CARD", 0, 2)).toEqual(original);
  forgetRedeemRequest(original);
  expect(redeemRequest("CARD", 0, 2).requestKey).not.toBe(original.requestKey);
});
it("does not send a new handover when its retry key cannot be saved", () => {
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("full"); });
  expect(() => redeemRequest("CARD", 0, 2)).toThrow("full");
});
