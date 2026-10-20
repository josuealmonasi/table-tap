import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: () => null }));
vi.stubGlobal("React", React);
import PaymentAttribution from "../PaymentAttribution";
describe("old payment with unknown currency", () => {
  it("shows the number and asks for currency evidence without guessing a symbol", () => {
    const html = renderToStaticMarkup(<PaymentAttribution timeZone="UTC" receipts={[
      { id: "old", amount: 100, tip: 0, currency: null, created_at: "2026-01-01T12:00:00Z" },
    ]} />);
    expect(html).toContain("100.00 · attribution.currencyUnknown");
    expect(html).not.toMatch(/MX\$|USD|\$100/);
  });
});
