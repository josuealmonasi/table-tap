// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SplitState } from "@/hooks/useSplit";
import { messagesFor, translate } from "@/lib/i18n";
import SplitBillCard from "../SplitBillCard";

const locale = vi.hoisted(() => ({ value: "en" as "en" | "es" }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) =>
  translate(messagesFor(locale.value), key, vars) }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));

let root: Root, host: HTMLDivElement;
const pay = vi.fn();
const split: SplitState = {
  id: "old", status: "locked", shares: 2, amount: 120, proposedBy: "diner", joined: 2,
  mine: { shareNo: 0, amount: 60, paid: false }, outstanding: 120, ownSince: 0, tipPrincipal: null,
};
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks(); host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

async function render(language: "en" | "es") {
  locale.value = language;
  await act(async () => root.render(<SplitBillCard split={split} diner="diner" busy={false} currency="MXN"
    tipPct={15} outstanding={120} party={2} cardsEnabled propose={vi.fn()} join={vi.fn()} cancel={vi.fn()} onPay={pay} />));
}
function button(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes(text));
  expect(found, text).toBeDefined(); return found!;
}
async function enter(amount: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, amount);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it.each(["en", "es"] as const)("previews and submits the same exact tip in %s", async language => {
  await render(language);
  expect(host.textContent).not.toMatch(/10%|15%|20%/);
  await act(async () => button(language === "en" ? "Other" : "Otro").click());
  await enter("5.25");
  expect(host.textContent).toContain("MX$65.25");
  await act(async () => button("MX$65.25").click());
  expect(pay).toHaveBeenCalledExactlyOnceWith(undefined, undefined, undefined, 5.25);
});

it("submits zero instead of the previous preset when no tip is chosen", async () => {
  await render("en");
  await act(async () => button("MX$60.00").click());
  expect(pay).toHaveBeenCalledExactlyOnceWith(undefined, undefined, undefined, 0);
});

it("keeps an oversized tip open for correction", async () => {
  await render("en");
  await act(async () => button("Other").click());
  await enter("1000");
  expect(host.querySelector("form")).not.toBeNull();
  expect(pay).not.toHaveBeenCalled();
});

it("lets the diner clear an exact tip and still pay the share", async () => {
  await render("en");
  await act(async () => button("Other").click());
  await enter("5.25");
  await act(async () => button("No tip").click());
  await act(async () => button("MX$60.00").click());
  expect(pay).toHaveBeenCalledExactlyOnceWith(undefined, undefined, undefined, 0);
});
