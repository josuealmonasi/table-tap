// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { tableBill } from "@/lib/table-bill";
const state = vi.hoisted(() => ({ locale: "en" as "en" | "es", toast: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => children }));
import { useBillPayment } from "../useBillPayment";
import { useReceiptOffer } from "../useReceiptOffer";
import ReceiptPrompt from "@/components/customer/ReceiptPrompt";

const scope = { restaurantId: "r", tableId: "table", sessionId: "session", dividing: true };
const paid = (paymentId: string, slots = [0]) => ({ paymentId, splitId: "split", slots });
let host: HTMLDivElement, root: Root, rows: ReturnType<typeof paid>[], fail: boolean;
let bill = tableBill([], []);
let receiptScope: typeof scope | undefined;
let offer: ReturnType<typeof useReceiptOffer>;
let payment: ReturnType<typeof useBillPayment>;
function Probe() {
  payment = useBillPayment("r", "table", "session");
  offer = useReceiptOffer(null, bill, receiptScope);
  return offer.paymentId ? <ReceiptPrompt key={offer.paymentId} open paymentId={offer.paymentId} email={false} onClose={offer.dismiss} /> : null;
}
async function render() { await act(async () => root.render(<Probe />)); }
async function poll() { await act(async () => vi.advanceTimersByTimeAsync(10_000)); }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear(); window.history.replaceState(null, "", "/"); rows = []; fail = false; bill = tableBill([], []); receiptScope = scope;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ payments: rows, split: true }, { status: fail ? 503 : 200 })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("remembers the selected parts only after card checkout gives a redirect", async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json({ url: window.location.href }));
  await render();
  await act(async () => payment.paySlots({ splitId: "split", revision: 2, slots: [2, 0], expectedCents: 5000 }));
  expect(JSON.parse(sessionStorage.getItem("tt.settling.slots") ?? "null")).toMatchObject({ restaurantId: "r", tableId: "table", sessionId: "session", splitId: "split", slots: [0, 2] });
});
it.each(["en", "es"] as const)("offers the returned card payment once, after a late confirmation (%s)", async locale => {
  state.locale = locale;
  sessionStorage.setItem("tt.settling.slots", JSON.stringify({ ...scope, splitId: "split", slots: [0, 2] }));
  window.history.replaceState(null, "", "/?settled=1");
  await render(); expect(offer.paymentId).toBeNull();
  rows = [paid("other", [1]), paid("card", [0, 2])]; await poll();
  expect(offer.paymentId).toBe("card");
  expect(host.textContent).toContain(translate(messagesFor(locale), "receipt.askTitle"));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === translate(messagesFor(locale), "receipt.noThanks"))!.click());
  expect(offer.paymentId).toBeNull(); await poll(); expect(offer.paymentId).toBeNull();
  await act(async () => root.unmount()); root = createRoot(host); await render(); expect(offer.paymentId).toBeNull();
});
it.each(["en", "es"] as const)("offers staff collections while other parts remain unpaid, without an order receipt (%s)", async locale => {
  state.locale = locale;
  await render(); rows = [paid("cash")]; await poll();
  expect(offer.paymentId).toBe("cash"); expect(offer.offering).toBeNull(); expect(offer.paidNow).toBe(true);
  expect(host.textContent).toContain(translate(messagesFor(locale), "receipt.askBodyPrint"));
});
it("queues simultaneous payments without replacing the receipt already open", async () => {
  await render(); rows = [paid("first"), paid("second", [1])]; await poll();
  expect(offer.paymentId).toBe("first");
  rows.push(paid("third", [2])); await poll(); expect(offer.paymentId).toBe("first");
  await act(async () => offer.dismiss()); expect(offer.paymentId).toBe("second");
  await act(async () => offer.dismiss()); expect(offer.paymentId).toBe("third");
});
it("keeps the last successful observation through a failed poll and does not offer history on first arrival", async () => {
  rows = [paid("old")]; await render(); expect(offer.paymentId).toBeNull();
  fail = true; rows.push(paid("new")); await poll(); expect(offer.paymentId).toBeNull();
  fail = false; await poll(); expect(offer.paymentId).toBe("new");
});
it("never offers the table's order receipt when its last parts close the bill", async () => {
  bill = { ...tableBill([], []), settled: false, mine: { ...tableBill([], []).mine, orders: [{ id: "order" } as never] } };
  await render(); rows = [paid("last")]; bill = tableBill([], []); await render(); await poll();
  expect(offer.offering).toBeNull(); expect(offer.paymentId).toBe("last");
});
it("keeps an unshown payment across refresh without repeating the receipt that was open", async () => {
  await render(); rows = [paid("first"), paid("waiting", [1])]; await poll(); expect(offer.paymentId).toBe("first");
  await act(async () => root.unmount()); root = createRoot(host); await render(); expect(offer.paymentId).toBe("waiting");
});
it("does not remember a refused card checkout as money paid", async () => {
  await render(); vi.mocked(fetch).mockImplementation(async () => Response.json({ error: "Already paid" }, { status: 409 }));
  await act(async () => payment.paySlots({ splitId: "split", revision: 2, slots: [0], expectedCents: 2500 }));
  expect(sessionStorage.getItem("tt.settling.slots")).toBeNull();
});
it("does not block a card redirect when the phone cannot remember the receipt", async () => {
  await render(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
  vi.mocked(fetch).mockImplementation(async () => Response.json({ url: window.location.href }));
  state.toast.mockClear(); await act(async () => payment.paySlots({ splitId: "split", revision: 2, slots: [0], expectedCents: 2500 }));
  expect(state.toast).not.toHaveBeenCalled();
});
it("keeps the queued receipt when React checks effect cleanup twice", async () => {
  await render(); rows = [paid("first"), paid("waiting", [1])]; await poll();
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<React.StrictMode><Probe /></React.StrictMode>));
  expect(offer.paymentId).toBe("waiting");
});
it("keeps the ordinary whole-bill cash offer", async () => {
  receiptScope = undefined;
  bill = { ...tableBill([], []), settled: false, mine: { ...tableBill([], []).mine, orders: [{ id: "order" } as never] } };
  await render(); bill = tableBill([], []); await render(); expect(offer.offering).toEqual(["order"]);
  expect(offer.paymentId).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});
it("keeps the ordinary whole-bill card return and forgets a cancelled slot checkout", async () => {
  receiptScope = undefined; sessionStorage.setItem("tt.settling", JSON.stringify(["order"]));
  window.history.replaceState(null, "", "/?settled=1"); await render(); expect(offer.offering).toEqual(["order"]);
});
