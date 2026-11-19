// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import AccountDialog from "@/components/dashboard/accounts/AccountDialog";
import { translate } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import type { AccountListItem } from "@/hooks/useOpenAccounts";
const state = vi.hoisted(() => ({ locale: "en", confirmed: true }));
const t = (key: string, vars?: Record<string, string | number>) => translate(state.locale === "en" ? en : es, key, vars);
vi.mock("@/lib/i18n/context", () => ({ useT: () => t, useLocale: () => ({ locale: state.locale }) }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => async () => state.confirmed }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/lib/qr", () => ({ qrSvg: async () => "" }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/dashboard/accounts/SettleAccountDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/accounts/AccountCreditDialog", () => ({ default: () => null }));
const account = { id: "a1", name: "Guest", email: "guest@example.com", code: "CODE", status: "open", owed: 0, credit_limit: 100 } as AccountListItem;
it.each([["en", "Remove email"], ["es", "Quitar correo"]])("shows removal only to managers in %s", async (locale, label) => {
  state.locale = locale; state.confirmed = false;
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ statement: { days: [], chargedBy: {}, owed: 0 } }) }); vi.stubGlobal("fetch", fetcher);
  const el = document.createElement("div"), root = createRoot(el), changed = vi.fn();
  const render = (canManage: boolean) => <AccountDialog account={account} onClose={() => {}} currency="MXN" timeZone="America/Mexico_City" canManage={canManage} onChanged={changed} />;
  try {
    await act(async () => root.render(render(false)));
    expect([...el.querySelectorAll("button")].some(b => b.textContent === label)).toBe(false);
    await act(async () => root.render(render(true)));
    const button = [...el.querySelectorAll("button")].find(b => b.textContent === label)!;
    expect(button).toBeTruthy(); await act(async () => button.click()); expect(fetcher).toHaveBeenCalledTimes(1);
    state.confirmed = true; await act(async () => button.click());
    expect(fetcher.mock.calls[1][0]).toBe("/api/account/remove-email");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ id: "a1" }); expect(changed).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
