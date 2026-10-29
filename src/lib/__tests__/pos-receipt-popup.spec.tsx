// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate, type Locale } from "@/lib/i18n";

const state = vi.hoisted(() => ({ toast: vi.fn(), refresh: vi.fn(), locale: "en" as Locale }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/i18n/context", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars),
  useLocale: () => ({ locale: state.locale }),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/lib/pos-last-sale", () => ({ rememberLastSale: vi.fn() }));
vi.mock("@/lib/print-window", () => ({ printWhenReady: vi.fn() }));
import { usePosCharge } from "@/hooks/usePosCharge";

let host: HTMLDivElement, root: Root, till: ReturnType<typeof usePosCharge>;
const popup = { document: { write: vi.fn(), close: vi.fn() }, close: vi.fn(), focus: vi.fn(), closed: false };
const cart = { lines: [{ itemId: "dish", name: "Soup", price: 100, qty: 1 }], clear: vi.fn() };
const details = { tipPct: 0, tipCustom: null, noTicket: false, customerName: "", note: "", email: "", terminalRef: "", reset: vi.fn() };
const offline = { hold: vi.fn(() => true), acknowledge: vi.fn(() => true), discard: vi.fn(), setOnline: vi.fn() };
function Till() {
  till = usePosCharge({ collector: "cashier", collectorContext: "signed", restaurant: { id: "r", name: "Place", currency: "MXN" },
    cart, details, offline, canEmailReceipt: true, pricing: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100 },
  } as unknown as Parameters<typeof usePosCharge>[0]);
  return null;
}
const success = (extra = {}) => Response.json({ code: "ORD-TEST", total: 100, settled: true, receiptHtml: "<p>Receipt</p>", ...extra });
beforeEach(async () => {
  vi.clearAllMocks(); state.locale = "en"; details.noTicket = false; details.email = ""; popup.closed = false;
  offline.hold.mockReturnValue(true); offline.acknowledge.mockReturnValue(true);
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", vi.fn(async () => success()));
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Till />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function charge() { await act(async () => till.charge("cash")); }
function expectSale() {
  expect(offline.acknowledge).toHaveBeenCalledTimes(1);
  expect(cart.clear).toHaveBeenCalledTimes(1);
  expect(details.reset).toHaveBeenCalledTimes(1);
  expect(state.refresh).toHaveBeenCalledTimes(1);
  expect(till.ticket).toMatchObject({ code: "ORD-TEST", total: 100 });
  expect(till.ticket?.offline).toBeUndefined();
  expect(offline.discard).not.toHaveBeenCalled();
}

it("reserves POS paper before a slow sale response", async () => {
  let answer!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = till.charge("cash"); });
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(popup.document.write).not.toHaveBeenCalled();
  await act(async () => { answer(success()); await pending; });
  expect(popup.document.write).toHaveBeenCalledWith(expect.stringContaining("<p>Receipt</p>"));
  expect(popup.close).not.toHaveBeenCalled();
  expectSale();
});

it.each(["blocked", "open throws", "write throws", "focus throws", "closed"])("keeps a completed sale when printing is %s", async failure => {
  if (failure === "blocked") vi.mocked(window.open).mockReturnValue(null);
  if (failure === "open throws") vi.mocked(window.open).mockImplementation(() => { throw new Error("blocked"); });
  if (failure === "write throws") popup.document.write.mockImplementationOnce(() => { throw new Error("write"); });
  if (failure === "focus throws") popup.focus.mockImplementationOnce(() => { throw new Error("focus"); });
  if (failure === "closed") popup.closed = true;
  await charge();
  expectSale();
  expect(state.toast).toHaveBeenCalledWith(expect.any(String), "error");
});

it.each<Locale>(["en", "es"])("explains a print failure in %s without retrying the sale", async locale => {
  state.locale = locale;
  await act(async () => root.render(<Till />));
  popup.document.write.mockImplementationOnce(() => { throw new Error("write"); });
  await charge();
  expect(state.toast).toHaveBeenCalledWith(translate(messagesFor(locale), "pos.printFailed"), "error");
  expect(translate(messagesFor(locale), "pos.printFailed")).not.toBe("pos.printFailed");
  expect(popup.close).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expectSale();
});

it("opens no window at all when the receipt goes by email", async () => {
  // Reserving one flashed an empty window, a new tab on an iPad, on every emailed sale.
  details.email = "guest@example.com";
  vi.mocked(fetch).mockResolvedValue(success({ receipt: "sent", receiptHtml: null }));
  await charge();
  expect(window.open).not.toHaveBeenCalled();
  expectSale();
});

it("uses the reserved paper when email fails", async () => {
  details.email = "guest@example.com";
  vi.mocked(fetch).mockResolvedValue(success({ receipt: "failed" }));
  await charge();
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(popup.document.write).toHaveBeenCalledTimes(1);
  expectSale();
});

it("closes the reserved paper for a refused sale", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ error: "closed" }, { status: 409 }));
  await charge();
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(popup.close).toHaveBeenCalledTimes(1);
  expect(cart.clear).not.toHaveBeenCalled();
});

it("does not reserve paper when the customer declined a receipt", async () => {
  details.noTicket = true;
  vi.mocked(fetch).mockResolvedValue(success({ receiptHtml: null }));
  await charge();
  expect(window.open).not.toHaveBeenCalled();
  expectSale();
});

it("still shows the held sale if its offline paper cannot open", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  vi.mocked(window.open).mockImplementation(() => { throw new Error("blocked"); });
  await charge();
  expect(fetch).not.toHaveBeenCalled();
  expect(offline.hold).toHaveBeenCalledTimes(1);
  expect(cart.clear).toHaveBeenCalledTimes(1);
  expect(till.ticket).toMatchObject({ offline: true });
});
