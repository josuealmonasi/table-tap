import { expect, it } from "vitest";
import { creditPreview } from "@/lib/account-credit";
it("previews partial relief in order and same-currency account cents", () => {
  expect(creditPreview("12.34", 30, 70)).toEqual({ amountCents: 1234, expectedCents: 3000, remainingCents: 1766, balanceCents: 5766 });
});
it("allows full relief and uses SQL decimal rounding for old totals", () => {
  expect(creditPreview("2.68", 2.675, 12.675)).toMatchObject({ expectedCents: 268, remainingCents: 0, balanceCents: 1000 });
});
it.each(["", "0", "-1", "1.001", "NaN", "Infinity", "1e2", "30.01", "1,00"])("refuses %s without rounding the ask", input => {
  expect(creditPreview(input, 30, 70)).toBeNull();
});
