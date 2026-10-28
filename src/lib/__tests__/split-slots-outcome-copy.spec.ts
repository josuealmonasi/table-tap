import { expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
const state = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number, _vars: unknown, extra: object) =>
  Response.json({ error: translate(messagesFor(state.locale), key), ...extra }, { status }) }));
import { splitResponse } from "@/lib/split-slots-rpc";
it.each(["en", "es"] as const)("a paid part is described from the payer or cashier's side in %s", async locale => {
  state.locale = locale;
  const response = await splitResponse({ outcome: "paid" }, []);
  const { error, code } = await response.json();
  expect(code).toBe("paid"); expect(error).toBe(locale === "en"
    ? "One of these parts is already paid. Check the parts again."
    : "Una de estas partes ya está pagada. Revisa las partes.");
});
it.each(["taken", "reserved", "below_minimum", "stale", "frozen"])("keeps bilingual copy and the %s outcome", async outcome => {
  for (const locale of ["en", "es"] as const) {
    state.locale = locale;
    const response = await splitResponse({ outcome }, []), body = await response.json();
    expect(response.status).toBe(409); expect(body.code).toBe(outcome);
    expect(body.error).not.toMatch(/^apiErr\./); expect(body.error.length).toBeGreaterThan(20);
  }
});
