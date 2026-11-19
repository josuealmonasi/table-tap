import { describe, expect, it } from "vitest";
import { priceChangeDate } from "@/lib/price-change-date";

const now = Date.parse("2026-11-17T12:00:00.000Z");
const days = 30 * 24 * 60 * 60 * 1000;

describe("price increase notice date", () => {
  it("refuses a date even one millisecond short of 30 days", () => {
    expect(priceChangeDate(new Date(now + days - 1).toISOString(), now)).toBeNull();
  });
  it("accepts 30 full days or more", () => {
    expect(priceChangeDate(new Date(now + days).toISOString(), now)).toBe(new Date(now + days).toISOString());
  });
  it("refuses missing and invalid dates", () => {
    expect(priceChangeDate(undefined, now)).toBeNull();
    expect(priceChangeDate("not a date", now)).toBeNull();
  });
});
