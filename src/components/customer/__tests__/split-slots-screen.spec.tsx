// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SplitBillCard from "../SplitBillCard";
import { translate } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(en, key, vars) }));
let root: Root, el: HTMLDivElement;
const pay = vi.fn(), propose = vi.fn();
const slotSplit = {
  id: "split", shares: 3, status: "locked" as const, amount: 12, proposedBy: "member", joined: 1,
  mine: null, outstanding: 8, ownSince: 0, modelVersion: 2, revision: 4, currency: "MXN", frozen: true,
  slots: [
    { shareNo: 0, amountCents: 400, feeCents: 0, paid: true, paying: false },
    { shareNo: 1, amountCents: 400, feeCents: 0, paid: false, paying: true },
    { shareNo: 2, amountCents: 400, feeCents: 0, paid: false, paying: false },
  ],
};
async function render(split: typeof slotSplit | null = null, cardsEnabled = true) {
  await act(async () => root.render(<SplitBillCard split={split} diner="member" busy={false} currency="MXN"
    outstanding={12} party={0} cardsEnabled={cardsEnabled} propose={propose} join={vi.fn()} cancel={vi.fn()} onPay={pay} />));
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks(); el = document.createElement("div"); root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("offers 2 to 20 people with one phone and starts a real cash-only split", async () => {
  await render(null, false);
  expect(el.querySelector("input[type=checkbox]")).not.toBeNull();
  await act(async () => el.querySelector<HTMLInputElement>("input")!.click());
  expect([...el.querySelectorAll("option")].map(o => Number(o.value))).toEqual(Array.from({ length: 19 }, (_, n) => n + 2));
  const start = el.querySelector<HTMLButtonElement>("button")!;
  await act(async () => start.click());
  expect(propose).toHaveBeenCalledWith(2);
});
it("shows every paid, held and free part without legacy join controls", async () => {
  await render(slotSplit);
  expect(el.querySelectorAll("[data-split-slot]")).toHaveLength(3);
  expect(el.textContent).toContain("Paid"); expect(el.textContent).toContain("Someone is paying");
  expect(el.textContent).toContain("Free"); expect(el.textContent).not.toContain("split.join");
  expect(el.querySelectorAll("input:disabled")).toHaveLength(2);
});
it("explains a below-minimum part and keeps the waiter available", async () => {
  await render(slotSplit);
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[2].click());
  expect(el.textContent).toContain("Choose more parts or ask the waiter");
  expect([...el.querySelectorAll("button")].some(b => b.disabled && /Pay/.test(b.textContent ?? ""))).toBe(true);
});
it("pays several free parts as one selection", async () => {
  await render({ ...slotSplit, slots: slotSplit.slots.map(s => ({ ...s, amountCents: 600, paid: false, paying: false })) });
  await act(async () => {
    el.querySelectorAll<HTMLInputElement>("input")[0].click();
    el.querySelectorAll<HTMLInputElement>("input")[1].click();
  });
  const button = [...el.querySelectorAll("button")].find(b => /Pay/.test(b.textContent ?? ""))!;
  await act(async () => button.click());
  expect(pay).toHaveBeenCalledWith([0, 1], 0);
});
