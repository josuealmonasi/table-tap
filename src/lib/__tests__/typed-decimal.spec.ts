import { describe, expect, it } from "vitest";
import { ambiguousDecimal, typedDecimal } from "@/lib/typed-decimal";
import { cashAmount } from "@/lib/cash-drawer";
import { decimal } from "@/lib/costs/input";

// A phone set to a decimal-comma region types "12,50" on its decimal keypad,
// and Mexican Excel writes "35,50". Both parsers deleted every comma, so a
// MX$12.50 withdrawal was saved as MX$1,250 and a 0,5 l pack as 5 l.
describe("typedDecimal", () => {
  it("reads a decimal comma as a decimal point", () => {
    expect(typedDecimal("12,50", 2)).toBe(12.5);
    expect(typedDecimal("12,5", 2)).toBe(12.5);
    expect(typedDecimal("0,5", 3)).toBe(0.5);
    expect(typedDecimal("0,500", 3)).toBe(0.5);
    expect(typedDecimal("1,25", 3)).toBe(1.25);
  });

  it("keeps the Mexican way of writing thousands", () => {
    expect(typedDecimal("1,250", 2)).toBe(1250);
    expect(typedDecimal("1,250.50", 2)).toBe(1250.5);
    expect(typedDecimal("12,500", 2)).toBe(12500);
    expect(typedDecimal("1,250,000", 3)).toBe(1250000);
    expect(typedDecimal(" 250.5 ", 2)).toBe(250.5);
    expect(typedDecimal(99.99, 2)).toBe(99.99);
  });

  it("refuses a quantity it would have to guess at", () => {
    // 1,500 kg is 1.5 with a decimal comma and 1500 in Mexico: never guess.
    expect(typedDecimal("1,500", 3)).toBeNull();
    expect(ambiguousDecimal("1,500", 3)).toBe(true);
    expect(typedDecimal("12,500", 3)).toBeNull();
    // Money has two decimals, so "1,500" can only be thousands there.
    expect(ambiguousDecimal("1,500", 2)).toBe(false);
    expect(ambiguousDecimal("0,500", 3)).toBe(false);
    expect(ambiguousDecimal("12,50", 3)).toBe(false);
  });

  it("refuses everything else instead of reshaping it", () => {
    for (const bad of ["", " ", "abc", "-5", "1.250,50", "1,2,3", "12,", ",5", "1,25.5", "12.345", "1e3", "NaN", "Infinity", "12 50", "1,2500"]) {
      expect(typedDecimal(bad, 2), bad).toBeNull();
    }
    expect(typedDecimal("2.5", 0)).toBeNull();
    expect(typedDecimal("2,5", 0)).toBeNull();
    expect(typedDecimal("3", 0)).toBe(3);
    expect(typedDecimal(null, 2)).toBeNull();
    expect(typedDecimal(Number.NaN, 2)).toBeNull();
  });
});

describe("the forms' parsers read it the same way", () => {
  it("a MX$12.50 withdrawal stays MX$12.50", () => {
    expect(cashAmount("12,50", true)).toBe(12.5);
    expect(cashAmount(" 1,250.00 ", false)).toBe(1250);
  });

  it("a 0,5 l pack stays half a litre, and a guessed quantity is refused", () => {
    expect(decimal("0,5", 1000, 3)).toBe(0.5);
    expect(decimal("1,500", 1_000_000, 3)).toBeNull();
    expect(decimal("1,250.5", 1_000_000, 3)).toBe(1250.5);
  });
});
