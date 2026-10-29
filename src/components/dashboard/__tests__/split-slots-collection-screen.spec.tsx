// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettleTableDialog from "../SettleTableDialog";
import TableCalculator from "../TableCalculator";
import { messagesFor } from "@/lib/i18n";
import { translate } from "@/lib/i18n";
const state = vi.hoisted(() => ({ toast: vi.fn(), locale: "en" as "en" | "es" }));
const { toast } = state;
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
const order = { id: "order", session_id: "session", total: 100, subtotal: 100, collected: 50, currency: "MXN", paid: false, status: "received", items: [] };
const split = { id: "split", restaurantId: "restaurant", tableId: "table", sessionId: "session", modelVersion: 2, revision: 4,
  status: "locked", currency: "MXN", shares: 2, amount: 100, outstanding: 50, frozen: false, slots: [
    { shareNo: 0, amountCents: 5000, paid: true, paying: false, feeCents: 0 },
    { shareNo: 1, amountCents: 5000, paid: false, paying: false, feeCents: 0 },
  ] };
let root: Root, el: HTMLDivElement;
let reply: { ok: boolean; checkoutCode?: string; code?: string; error?: string; settled?: boolean; outcome?: string; payment?: string; amount_cents?: number; tip_cents?: number; owed?: number };
const collected = vi.fn();
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks(); state.locale = "en"; reply = { ok: true, settled: false, outcome: "collected", amount_cents: 5000, tip_cents: 0, owed: 0 };
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init) => init
    ? { ok: reply.ok, json: async () => reply }
    : { ok: true, json: async () => ({ orders: [order], outstanding: { owed: 50, ordered: 100, collected: 50, tips: 0, currency: "MXN" }, splits: [split] }) }));
  el = document.createElement("div"); root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(calculator = false) {
  await act(async () => root.render(calculator
    ? <TableCalculator open tableId="table" tableLabel="1" currency="MXN" onClose={vi.fn()} onCollected={collected} />
    : <SettleTableDialog open restaurantId="restaurant" tableId="table" tableLabel="1" currency="MXN" onClose={vi.fn()} onSettled={collected} canApprove />));
}
it.each([false, true])("offers the same free-slot selector instead of whole-bill collection (calculator=%s)", async calculator => {
  await render(calculator);
  expect(el.querySelectorAll("[data-split-slot]")).toHaveLength(2);
  expect(el.textContent).toContain("1 of 2 parts paid");
  expect(el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[0].disabled).toBe(true);
  const cash = [...el.querySelectorAll("button")].find(b => /Paid cash/.test(b.textContent ?? ""))!;
  expect(cash.disabled).toBe(true);
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
  await act(async () => cash.click());
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init);
  expect(writes).toHaveLength(1); expect(writes[0][0]).toBe("/api/split/collect");
  expect(JSON.parse(writes[0][1]!.body as string)).toMatchObject({ splitId: "split", revision: 4, slots: [1], expectedCents: 5000, method: "cash" });
});
it("visibly cancels against the current revision before any attempt", async () => {
  await render();
  const cancel = [...el.querySelectorAll("button")].find(b => /Stop dividing/.test(b.textContent ?? ""));
  expect(cancel).toBeDefined();
  await act(async () => cancel!.click());
  const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/split/cancel");
  expect(JSON.parse(call![1]!.body as string)).toMatchObject({ splitId: "split", revision: 4 });
});
it.each(["taken", "paid", "reserved", "below_minimum", "stale", "frozen", "split"])("shows the %s refusal and rereads before the next collection", async code => {
  reply = { ok: false, code, error: `Translated ${code} refusal` };
  await render();
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
  await act(async () => [...el.querySelectorAll("button")].find(b => /Paid cash/.test(b.textContent ?? ""))!.click());
  expect(el.textContent).toContain(reply.error);
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => !init).length).toBeGreaterThan(1);
  expect(collected).not.toHaveBeenCalled();
});

it("collects a chosen part on the restaurant's terminal through the same writer", async () => {
  await render();
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
  await act(async () => [...el.querySelectorAll("button")].find(b => /Paid by card/.test(b.textContent ?? ""))!.click());
  const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/split/collect");
  expect(JSON.parse(call![1]!.body as string)).toMatchObject({ method: "card", slots: [1], expectedCents: 5000 });
});
it("retries lost collection replies with the same reference", async () => {
  await render();
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
  vi.mocked(fetch).mockRejectedValueOnce(new Error("lost reply"));
  await act(async () => [...el.querySelectorAll("button")].find(b => /Paid cash/.test(b.textContent ?? ""))!.click());
  await act(async () => [...el.querySelectorAll("button")].find(b => /Paid cash/.test(b.textContent ?? ""))!.click());
  const bodies = vi.mocked(fetch).mock.calls.filter(([, init]) => init).map(([, init]) => JSON.parse(init!.body as string));
  expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
});
it("shows the frozen explanation instead of offering cancellation after an attempt", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ orders: [order], splits: [{ ...split, frozen: true }] }) } as Response);
  await render();
  expect(el.textContent).toContain("Someone has already tried to pay");
  expect([...el.querySelectorAll("button")].some(b => /Stop dividing/.test(b.textContent ?? ""))).toBe(false);
});
it.each([false, true])("switches to parts immediately when the whole-bill writer answers split (calculator=%s)", async calculator => {
  let divided = false;
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init) { divided = true; return { ok: false, json: async () => ({ code: "split", error: "Choose the parts." }) } as Response; }
    return { ok: true, json: async () => ({ orders: [order], outstanding: { ordered: 100, owed: 50, collected: 50, tips: 0, currency: "MXN" }, splits: divided ? [split] : [] }) } as Response;
  });
  await render(calculator);
  expect(el.querySelectorAll("[data-split-slot]")).toHaveLength(0);
  await act(async () => el.querySelector<HTMLButtonElement>("[data-whole-bill-collect]")!.click());
  expect(el.querySelectorAll("[data-split-slot]")).toHaveLength(2);
  expect(el.querySelectorAll("[data-whole-bill-collect]")).toHaveLength(0);
});

it.each([[false, "en"], [true, "en"], [false, "es"], [true, "es"]] as const)("prints the collected part by payment id after the last split disappears (calculator=%s, %s)", async (calculator, locale) => {
  state.locale = locale;
  reply = { ...reply, payment: "part-payment" };
  await render(calculator);
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
  vi.mocked(fetch).mockImplementation(async (_url, init) => init
    ? { ok: true, json: async () => reply } as Response
    : { ok: true, json: async () => ({ orders: [], splits: [], outstanding: { owed: 0, currency: "MXN" } }) } as Response);
  await act(async () => [...el.querySelectorAll("button")].find(b => (b.textContent ?? "").includes(translate(messagesFor(locale), "settle.cash")))!.click());
  const print = [...el.querySelectorAll("button")].find(b => (b.textContent ?? "").includes(translate(messagesFor(locale), "slots.printPart")));
  expect(print).toBeDefined();
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ html: "<p>Part paid</p>" }) } as Response);
  const popup = { document: { write: vi.fn(), close: vi.fn(), readyState: "complete", fonts: { ready: Promise.resolve() } }, focus: vi.fn(), print: vi.fn(), addEventListener: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  await act(async () => print!.click());
  const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/orders/print");
  expect(JSON.parse(call![1]!.body as string)).toEqual({ paymentId: "part-payment", to: "receipt" });
  expect(popup.document.write).toHaveBeenCalledWith(expect.stringContaining("Part paid"));
});
it("labels the payment print with its total without adding its tip twice", async () => {
  reply = { ...reply, payment: "part-payment", amount_cents: 5500, tip_cents: 500 };
  await render();
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
  await act(async () => [...el.querySelectorAll("button")].find(b => b.textContent?.startsWith("10%"))!.click());
  await act(async () => [...el.querySelectorAll("button")].find(b => /Paid cash/.test(b.textContent ?? ""))!.click());
  const print = el.querySelector("[data-slot-receipt-print]");
  expect(print?.textContent).toContain("55.00");
});

it.each([false, true])("offers a status check for the exact refused parts (calculator=%s)", async calculator => {
  reply = { ok: false, checkoutCode: "checkout_unresolved", code: "reserved", error: "Unconfirmed" };
  await render(calculator);
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
  await act(async () => [...el.querySelectorAll("button")].find(b => /Paid cash/.test(b.textContent ?? ""))!.click());
  const check = [...el.querySelectorAll("button")].find(b => b.textContent === "Check payment");
  expect(check).toBeDefined();
  // Editing the selection must not change what the earlier refusal checks.
  await act(async () => el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
  vi.mocked(fetch).mockResolvedValue(Response.json({ outcome: "closed" }));
  await act(async () => check!.click());
  const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init);
  expect(calls.map(([url]) => url)).toEqual(["/api/split/collect", "/api/checkout/check"]);
  expect(JSON.parse(calls[1][1]!.body as string)).toEqual({ kind: "split", splitId: "split", slots: [1] });
  expect(collected).not.toHaveBeenCalled();
});

it.each([false, true])("checking a refused split cancellation never repeats it (calculator=%s)", async calculator => {
  reply = { ok: false, checkoutCode: "checkout_unresolved", code: "paying", error: "Unconfirmed" };
  await render(calculator);
  await act(async () => [...el.querySelectorAll("button")].find(b => /Stop dividing/.test(b.textContent ?? ""))!.click());
  vi.mocked(fetch).mockImplementation(async url => url === "/api/checkout/check"
    ? Response.json({ outcome: "unverified" })
    : Response.json({ orders: [order], splits: [split], outstanding: { owed: 50, currency: "MXN" } }));
  await act(async () => [...el.querySelectorAll("button")].find(b => b.textContent === "Check payment")!.click());
  const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init);
  expect(calls.map(([url]) => url)).toEqual(["/api/split/cancel", "/api/checkout/check"]);
  expect(JSON.parse(calls[1][1]!.body as string)).toEqual({ kind: "split", splitId: "split" });
  expect(collected).not.toHaveBeenCalled();
});
