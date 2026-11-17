// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import AccountStatement from "../AccountStatement";
import { translate } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
const state = vi.hoisted(() => ({ locale: "en", confirmed: false, confirm: vi.fn(async () => state.confirmed) }));
const t = (key: string, vars?: Record<string, string | number>) => translate(state.locale === "en" ? en : es, key, vars);
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: state.locale }), useT: () => t }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => state.confirm }));
vi.mock("@/hooks/useStatementMail", () => ({ useStatementMail: () => vi.fn() }));
it.each([["en", "Remove my email"], ["es", "Quitar mi correo"]])("offers confirmed removal in %s", async (locale, label) => {
  state.locale = locale;
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.confirmed = false; state.confirm.mockClear();
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ restaurant: { id: "r", name: "Cafe", currency: "MXN" }, name: "Guest", status: "open", owed: 0, days: [], payments: [], cardsEnabled: false, payingOnline: false, canEmail: true, hasEmail: true }) }).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetcher);
  const el = document.createElement("div"), root = createRoot(el);
  try {
    await act(async () => root.render(<AccountStatement code="CODE" paid={false} />));
    const button = [...el.querySelectorAll("button")].find(b => b.textContent === label)!;
    expect(button).toBeTruthy();
    await act(async () => button.click()); expect(fetcher).toHaveBeenCalledTimes(1);
    state.confirmed = true; await act(async () => button.click()); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state.confirm).toHaveBeenCalled();
    expect([...el.querySelectorAll("button")].some(b => b.textContent === label)).toBe(false);
    expect(fetcher.mock.calls[1][0]).toBe("/api/account/remove-email");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ c: "CODE" });
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("hides removal when the account has no saved email", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ restaurant: { id: "r", name: "Cafe", currency: "MXN" }, name: "Guest", status: "open", owed: 0, days: [], payments: [], cardsEnabled: false, payingOnline: false, canEmail: true, hasEmail: false }) }));
  const el = document.createElement("div"), root = createRoot(el);
  try { await act(async () => root.render(<AccountStatement code="CODE" paid={false} />)); expect(el.textContent).not.toContain(state.locale === "en" ? "Remove my email" : "Quitar mi correo"); }
  finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
