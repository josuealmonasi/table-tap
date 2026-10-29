import { expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

it.each([en.apiErr, es.apiErr])("staff see an unconfirmed payment, a retry and a manager (%#)", copy => {
  for (const key of ["accountBillPaying", "accountPayingOnline", "writeOffPaying", "splitBillPaying", "splitSlotPaying"] as const) {
    expect(copy[key]).toMatch(/unconfirmed|not been confirmed|sin confirmar/);
    expect(copy[key]).toMatch(/try again|intentarlo/i);
    expect(copy[key]).toMatch(/manager|gerente/);
    expect(copy[key]).not.toMatch(/right now|en este momento/);
  }
});
