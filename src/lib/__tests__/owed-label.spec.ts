import { describe, expect, it } from "vitest";
import { owedLabel } from "@/lib/currency-balances";
import { formatMoney } from "@/lib/format";

describe("owedLabel", () => {
  it("says zero, in the account's currency, for an account with no charges", () => {
    // The row read "Debe  de MX$1,000.00" (owner's screenshot, 2026-11-10).
    expect(owedLabel([], "MXN")).toBe(formatMoney(0, "MXN"));
    expect(owedLabel(undefined, "USD")).toBe(formatMoney(0, "USD"));
  });

  it("keeps every currency's debt apart", () => {
    const label = owedLabel([{ currency: "MXN", amount: 33 }, { currency: "USD", amount: 5 }], "MXN");
    expect(label).toContain(formatMoney(33, "MXN"));
    expect(label).toContain(formatMoney(5, "USD"));
  });
});
