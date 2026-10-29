import { expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
import { apiError } from "@/lib/api-error";
it.each(["accountBillPaying", "accountPayingOnline", "splitBillPaying", "splitSlotPaying", "writeOffPaying"])("%s has the same recovery code without losing its existing outcome", async key => {
  const response = await apiError(`apiErr.${key}`, 409, undefined, { code: "reserved" });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ checkoutCode: "checkout_unresolved", code: "reserved" });
});
it("historical payment attribution stays separate from a card-page refusal", async () => {
  expect(await (await apiError("apiErr.writeOffUnresolved", 409)).json()).not.toHaveProperty("checkoutCode");
});
