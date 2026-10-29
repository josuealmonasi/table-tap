// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import SettleTableDialog from "../SettleTableDialog";
import TableCalculator from "../TableCalculator";
const state = vi.hoisted(() => ({ locale: "en" as "en" | "es", toast: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
const base = { id: "split", restaurantId: "restaurant", tableId: "table", sessionId: "session", modelVersion: 2,
  revision: 4, status: "locked", currency: "MXN", shares: 2, amount: 100, outstanding: 50, frozen: true,
  orderIds: ["first", "second"], slots: [
    { shareNo: 0, amountCents: 5000, paid: true, paying: false },
    { shareNo: 1, amountCents: 5000, paid: false, paying: false },
  ] };
let split: typeof base;
let host: HTMLDivElement, root: Root;
const applied = vi.fn();
const text = (key: string) => translate(messagesFor(state.locale), key);
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label);
async function render(calculator = false, canApprove = true) {
  await act(async () => root.render(calculator
    ? <TableCalculator open tableId="table" tableLabel="1" currency="MXN" onClose={vi.fn()} onCollected={applied} {...{ canApprove }} />
    : <SettleTableDialog open restaurantId="restaurant" tableId="table" tableLabel="1" currency="MXN" onClose={vi.fn()} onSettled={applied} canApprove={canApprove} />));
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  state.locale = "en"; split = structuredClone(base);
  host = document.createElement("div"); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({
    orders: [{ id: "first", session_id: "session", total: 100, collected: 50, paid: false, currency: "MXN", status: "received", items: [] }],
    splits: [split], outstanding: { owed: 80, ordered: 130, collected: 50, currency: "MXN" },
  }) })));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it.each([false, true])("offers the remainder through both collection doors (calculator=%s)", async calculator => {
  await render(calculator);
  expect(button("Write off the rest")).toBeDefined();
  await act(async () => button("Write off the rest")!.click());
  expect(host.querySelectorAll("[role=dialog]")).toHaveLength(1);
  expect(host.querySelector(".tt-writeoff-amount strong")?.textContent).toContain("50.00");
  expect(host.textContent).toContain("The paid parts stay paid");
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
  await act(async () => button(text("writeOff.rest"))!.click());
  const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/bill/write-off");
  expect(JSON.parse(call![1]!.body as string)).toEqual({ orderIds: ["first", "second"], expectedCents: 5000, reason: "walkout", note: "" });
  expect(applied).toHaveBeenCalledTimes(1);
});
it.each(["owner", "manager", "waiter", "cashier"])("keeps %s on the existing decision or request flow", async role => {
  const canApprove = role === "owner" || role === "manager";
  await render(false, canApprove);
  await act(async () => button(canApprove ? "Write off the rest" : "Request cancellation")!.click());
  expect(host.textContent).toContain(text(canApprove ? "writeOff.restBody" : "writeOff.askBody"));
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ pending: !canApprove }) } as Response);
  await act(async () => button(text(canApprove ? "writeOff.rest" : "writeOff.request"))!.click());
  expect(state.toast).toHaveBeenCalledWith(text(canApprove ? "writeOff.done" : "writeOff.sent"));
});
it.each(["proposed", "done", "cancelled", "legacy", "held", "paid"])("hides write-off for %s parts", async condition => {
  if (["proposed", "done", "cancelled"].includes(condition)) split.status = condition;
  if (condition === "legacy") split.modelVersion = 1;
  if (condition === "held") split.slots[1].paying = true;
  if (condition === "paid") split.slots[1].paid = true;
  await render(); expect(button("Write off the rest")).toBeUndefined();
});
it("offers a locked division before its first payment", async () => {
  split.slots[0].paid = false; split.outstanding = 100;
  await render(); expect(button("Write off the rest")).toBeDefined();
});
it.each(["en", "es"] as const)("explains retained parts and each refusal inside the active dialog (%s)", async locale => {
  state.locale = locale; await render();
  await act(async () => button(locale === "en" ? "Write off the rest" : "Perdonar lo que falta")!.click());
  expect(host.textContent).toContain(locale === "en" ? "The paid parts stay paid" : "Las partes pagadas se conservan");
  for (const key of ["writeOffSplit", "writeOffPaying", "writeOffChanged"]) {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: text(`apiErr.${key}`) }) } as Response);
    await act(async () => button(text("writeOff.rest"))!.click());
    expect(host.querySelector("[role=alert]")?.textContent).toBe(text(`apiErr.${key}`));
    expect(host.querySelectorAll("[role=dialog]")).toHaveLength(1);
  }
  expect(applied).not.toHaveBeenCalled();
});

it.each([false, true])("Back returns to collection with one dialog (calculator=%s)", async calculator => {
  await render(calculator);
  await act(async () => button("Write off the rest")!.click());
  await act(async () => button(text("writeOff.back"))!.click());
  expect(host.querySelector(".tt-writeoff-amount")).toBeNull();
  expect(host.querySelectorAll("[role=dialog]")).toHaveLength(1);
  expect(button("Write off the rest")).toBeDefined();
  expect(fetch).not.toHaveBeenCalledWith("/api/bill/write-off", expect.anything());
});
