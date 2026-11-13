// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import AccountStatement from "../AccountStatement";
import { translate } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
const t = (key: string, vars?: Record<string, string | number>) => translate(en, key, vars);
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: "en" }), useT: () => t }));
vi.mock("@/hooks/useStatementMail", () => ({ useStatementMail: () => vi.fn() }));

it("account chips use only the selected currency's food and submit the percentage for server repricing", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({
    restaurant: { id: "r", name: "Cafe", currency: "MXN" }, name: "Guest", status: "open", owed: 120,
    currency: "MXN", balances: [{ currency: "MXN", amount: 120 }], tipBalances: [{ currency: "MXN", amount: 100 }],
    days: [], payments: [], cardsEnabled: true, payingOnline: false, canEmail: false,
  }) }).mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: "Refused" }) });
  vi.stubGlobal("fetch", fetcher);
  const el = document.createElement("div"), root = createRoot(el);
  try {
    await act(async () => root.render(<AccountStatement code="CODE" paid={false} />));
    const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.startsWith(text))!;
    await act(async () => button("Pay online").click());
    expect(button("15%").textContent).toContain("15.00");
    await act(async () => button("15%").click());
    expect(button("Pay MX$").textContent).toContain("135.00");
    await act(async () => button("Pay MX$").click());
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ c: "CODE", expected: 120, currency: "MXN", tipPct: 15 });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
