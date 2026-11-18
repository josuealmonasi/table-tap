import { expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

it("tells diners to retry a racing page without asking for a missing field", () => {
  expect(en.apiErr.splitOpenTip).toBe("Another payment page for your share just opened. Try again in a moment.");
  expect(es.apiErr.splitOpenTip).toBe("Se acaba de abrir otra página de pago para tu parte. Inténtalo de nuevo en un momento.");
});
