import { expect, it } from "vitest";
import { cashCases } from "../../../scripts/api-cases/cash.mjs";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

it.each([en, es])("the held-cash API case accepts the cashier's actual refusal", messages => {
  const check = cashCases({ restaurant: { id: "restaurant", currency: "MXN" } })
    .find((item: { name: string }) => item.name === "POST /api/cash-shift (offline cash still awaits review)");
  expect(check?.as).toBe("cashier");
  expect(check?.expect).toEqual([409]);
  const refusal = check && "expectError" in check ? check.expectError : undefined;
  if (!(refusal instanceof RegExp)) throw new Error("Held-cash API case has no refusal matcher");
  expect(messages.apiErr.shiftHeldCashCashier.replace("{n}", "1")).toMatch(refusal);
});
