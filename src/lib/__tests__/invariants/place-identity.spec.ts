import { describe, expect, it } from "vitest";
import { placeIdentity } from "@/lib/place-identity";
import { PUBLIC_RESTAURANT_COLUMNS } from "@/lib/public-menu-rows";
import { FISCAL_KEYS } from "@/lib/fiscal-settings";
import { read } from "./helpers";

/**
 * A diner sees who they are paying before they pay (legal review 2026-11-13,
 * items 6 and 17). The data is fiscal, so it travels the ticket's server-side
 * path and never the public columns.
 */
const row = {
  name: "Tacos", legal_name: "Tacos SA de CV", address_street: "Calle", address_ext_number: "1", address_int_number: null,
  address_colonia: "Centro", address_postal_code: "06000", address_municipality: "CDMX", address_state: "CDMX",
};

describe("diner legal identity", () => {
  it("uses the razón social, else the trade name, with the ticket's address", () => {
    expect(placeIdentity(row)).toEqual({ name: "Tacos SA de CV", address: "Calle 1, Col. Centro, C.P. 06000, CDMX, CDMX" });
    expect(placeIdentity({ ...row, legal_name: "  " }).name).toBe("Tacos");
  });

  it("never widens the public restaurant columns", () => {
    for (const field of FISCAL_KEYS) expect(PUBLIC_RESTAURANT_COLUMNS).not.toContain(field);
    expect(PUBLIC_RESTAURANT_COLUMNS).not.toContain("address_");
    expect(read("src/lib/place-identity.ts")).toContain("createAdminClient");
  });

  it.each(["src/app/r/[restaurantId]/page.tsx", "src/app/r/[restaurantId]/t/[tableId]/page.tsx"])("%s loads the identity and hands it to the app", file => {
    const src = read(file);
    expect(src).toContain("loadPlaceIdentity(restaurantId)");
    expect(src).toContain("identity={identity}");
  });

  it.each(["MenuScreen", "CartScreen", "BillSheet"])("%s renders the identity block", name => {
    const src = read(`src/components/customer/${name}.tsx`);
    expect(src).toContain("<PlaceIdentity identity={identity} />");
  });

  it("the receipt email and pickup name fields carry the short notice", () => {
    expect(read("src/components/customer/ReceiptPrompt.tsx")).toContain('<PrivacyHint field="email" />');
    expect(read("src/components/customer/CartScreen.tsx")).toContain('<PrivacyHint field="name" />');
  });
});
