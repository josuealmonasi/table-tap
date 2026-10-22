import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { promoPricingError } from "@/lib/promo-guard";
it("K23: promotion refusals return translation keys and variables", () => {
  expect(promoPricingError({ kind: "combo", comboPrice: 90, items: [{ itemId: "p", qty: 1 }] }, new Map([["p", { id: "p", price: 80 }]])))
    .toEqual({ key: "apiErr.comboNotCheaper", vars: { regular: "80.00" } });
});
it("K19: dirty forms register a shared discard guard", () => {
  for (const file of ["src/components/dashboard/menu/ProductForm.tsx", "src/components/dashboard/costs/RecipeDialog.tsx", "src/components/dashboard/promotions/ComboForm.tsx"]) {
    expect(readFileSync(file, "utf8"), file).toContain("useDirtyClose");
  }
});

import { checkoutLineItems } from "@/lib/checkout/line-items";
import { authErrorKey } from "@/lib/auth-error";
import { zonedInput, zonedTimestamp } from "@/lib/zoned-input";
import { messagesFor, translate } from "@/lib/i18n";
it("K23: checkout generates Spanish service and tip labels", () => {
  const lines = checkoutLineItems({ verified: [], currency: "mxn", serviceFee: 10, servicePct: 10, tip: 12.34, tipPct: 0, locale: "es" });
  expect(lines.map(l => l.price_data?.product_data?.name)).toEqual(["Servicio (10%)", "Propina"]);
  expect(checkoutLineItems({ verified: [], currency: "mxn", serviceFee: 0, servicePct: 0, tip: 10, tipPct: 15, locale: "es" })[0].price_data?.product_data?.name).toBe("Propina (15%)");
});
it("K22/K23: Auth codes translate while recovery hides account existence", () => {
  for (const locale of ["en", "es"] as const) {
    for (const code of ["invalid_credentials", "email_not_confirmed", "weak_password", "same_password", "session_expired", "unexpected_failure", "over_email_send_rate_limit"]) {
      const key = authErrorKey({ code })!;
      expect(translate(messagesFor(locale), key)).not.toBe(key);
    }
  }
  expect(authErrorKey({ code: "user_not_found" }, true)).toBeNull();
  expect(authErrorKey({ status: 503 }, true)).toBe("auth.unavailable");
});
it("K15: coupon times round-trip in the restaurant zone, independent of the device", () => {
  expect(zonedTimestamp("2026-10-22T12:00", "America/Mexico_City")).toBe("2026-10-22T12:00:00-06:00");
  expect(zonedInput("2026-10-22T18:00:00Z", "America/Cancun")).toBe("2026-10-22T13:00");
  expect(zonedTimestamp("2026-07-22T12:00", "America/New_York")).toBe("2026-07-22T12:00:00-04:00");
  expect(zonedTimestamp("2026-03-08T02:30", "America/New_York")).toBeNull();
  expect(zonedTimestamp("2026-11-01T01:30", "America/New_York")).toBeNull();
});
