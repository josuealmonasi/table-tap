// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import AccountCreditDialog from "../AccountCreditDialog";
const state = vi.hoisted(() => ({ locale: "en" as "en" | "es", toast: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
let host: HTMLDivElement, root: Root;
const changed = vi.fn(), close = vi.fn();
const t = (key: string) => translate(messagesFor(state.locale), key);
const button = (key: string) => [...host.querySelectorAll("button")].find(b => b.textContent === t(key))!;
async function render() {
  await act(async () => root.render(<AccountCreditDialog charge={{ orderId: "order", total: 30, at: "2026-11-10", tableLabel: null, lines: [] }}
    owed={70} currency="MXN" onClose={close} onCredited={changed} />));
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); state.locale = "en";
  host = document.createElement("div"); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it.each(["en", "es"] as const)("defaults to full credit and shows resulting balances (%s)", async locale => {
  state.locale = locale; await render();
  expect(host.querySelector("input")?.value).toBe("30.00");
  expect(host.textContent).toContain("MX$0.00"); expect(host.textContent).toContain("MX$40.00");
  await act(async () => button("accountCredit.confirm").click());
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({ orderId: "order", amountCents: 3000, expectedCents: 3000, reason: "error", note: "" });
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.toast).toHaveBeenCalledWith(t("accountCredit.done")); expect(changed).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});
it("requires an Other note and preserves the retry reference after an uncertain response", async () => {
  await render(); await act(async () => button("accountCredit.other").click());
  expect(button("accountCredit.confirm").disabled).toBe(true);
  await act(async () => button("accountCredit.error").click());
  vi.mocked(fetch).mockRejectedValueOnce(new Error("connection lost"));
  await act(async () => button("accountCredit.confirm").click());
  expect(close).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  await act(async () => button("accountCredit.confirm").click());
  const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
  expect(bodies[0]).toEqual(bodies[1]); expect(changed).toHaveBeenCalledOnce();
});
it("keeps a stale-balance refusal visible without reporting success", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: "The balance changed. Refresh the statement." }) } as Response);
  await render(); await act(async () => button("accountCredit.confirm").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("balance changed");
  expect(changed).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
