// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { usePosSaleDetails } from "../usePosSaleDetails";
import { usePosCharge } from "../usePosCharge";
import PosAsk from "@/components/dashboard/pos/PosAsk";
import { replayBody, type HeldSale } from "@/lib/offline-sales";
const s = vi.hoisted(() => ({ toast: vi.fn(), print: vi.fn(), hold: vi.fn((sale: HeldSale) => Boolean(sale)) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars), useLocale: () => ({ locale: "es" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => s.toast }));
vi.mock("@/lib/receipt-popup", () => ({ reserveReceiptPopup: () => ({ print: s.print, close: vi.fn() }) }));
vi.mock("@/lib/pos-last-sale", () => ({ rememberLastSale: vi.fn() }));
vi.mock("@/components/customer/DetailOverlay", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
let details: ReturnType<typeof usePosSaleDetails>, charge: ReturnType<typeof usePosCharge>, root: Root, host: HTMLDivElement;
function Harness() {
  details = usePosSaleDetails();
  charge = usePosCharge({ collector: "cashier", collectorContext: "signed", restaurant: { id: "r", name: "Cafe", currency: "MXN" },
    cart: { lines: [{ itemId: "dish", name: "Soup", emoji: "", mods: {}, price: 100, qty: 1 }], clear: vi.fn() }, details,
    offline: { hold: s.hold, acknowledge: () => true, discard: vi.fn(), setOnline: vi.fn() }, canEmailReceipt: true,
    pricing: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100, lines: [], promoSavings: {} },
  } as unknown as Parameters<typeof usePosCharge>[0]);
  return <PosAsk details={details} method="cash" total={100} subtotal={100} currency="MXN" canEmailReceipt busy={charge.busy} allHandedOver onClose={vi.fn()} onSend={() => void charge.charge("cash")} />;
}
const t = (key: string) => translate(messagesFor("es"), key);
const check = (key: string) => [...host.querySelectorAll("label")].find(l => l.textContent === t(key))?.querySelector<HTMLInputElement>("input");
const post = () => vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/pos/order")!;
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("navigator", { onLine: true }); vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).startsWith("/api/loyalty/card-email?") ? Response.json({ email: "j***@hotmail.com" })
    : url === "/api/loyalty/card-email" ? Response.json({ outcome: "saved", email: "n***@example.com" })
    : Response.json({ settled: true, orderId: "sale", total: 100, code: "sale", receiptHtml: "ticket" })));
  host = document.createElement("div"); root = createRoot(host);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Harness /></SWRConfig>));
  await act(async () => details.setLoyaltyCard({ code: "K7QM3XW9K7P2", suffix: "K7P2", progress: 1, goal: 8 }));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("shows the masked card address, sends skip, and keeps the choice in offline replay", async () => {
  expect(host.textContent).toContain("El ticket se enviará a j***@hotmail.com");
  expect(host.querySelector('input[type="email"]')).toBeNull(); expect(check("cardEmail.skip")).toBeTruthy();
  await act(async () => check("cardEmail.skip")!.click());
  await act(async () => charge.charge("cash"));
  expect(JSON.parse(post()[1]!.body as string)).toMatchObject({ skipTicketEmail: true, loyaltyCode: "K7QM3XW9K7P2" });
  expect(replayBody(s.hold.mock.calls[0][0]).skipTicketEmail).toBe(true);
});
it("automatically emailed tickets do not print a second paper copy or send a per-sale email", async () => {
  await act(async () => details.setEmail("old@example.com"));
  await act(async () => charge.charge("cash"));
  expect(JSON.parse(post()[1]!.body as string).email).toBeUndefined(); expect(s.print).not.toHaveBeenCalled();
});
it("no ticket also declines the automatic email", async () => {
  await act(async () => details.setNoTicket(true)); await act(async () => charge.charge("cash"));
  expect(JSON.parse(post()[1]!.body as string).skipTicketEmail).toBe(true);
});
async function withoutEmail() {
  vi.mocked(fetch).mockImplementation(async url => String(url).startsWith("/api/loyalty/card-email?") ? Response.json({ email: null })
    : url === "/api/loyalty/card-email" ? Response.json({ outcome: "saved", email: "n***@example.com" })
    : Response.json({ settled: true, orderId: "sale", total: 100, code: "sale", receipt: "sent", receiptHtml: null }));
  await act(async () => details.setLoyaltyCard({ code: "ABCD3XW9K7P2", suffix: "K7P2", progress: 1, goal: 8 }));
  await act(async () => details.setEmail("new@example.com"));
  expect(host.querySelector('input[type="email"]')).not.toBeNull();
  await act(async () => check("cardEmail.saveOnCard")!.click());
}
it("saves on the card before charging with consent and sends only the existing per-sale ticket", async () => {
  await withoutEmail(); await act(async () => check("cardEmail.staffConsent")!.click());
  await act(async () => charge.charge("cash"));
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes.map(([url]) => url)).toEqual(["/api/loyalty/card-email", "/api/pos/order"]);
  expect(JSON.parse(writes[0][1]!.body as string)).toEqual({ code: "ABCD3XW9K7P2", email: "new@example.com", consent: true });
  expect(JSON.parse(post()[1]!.body as string)).toMatchObject({ email: "new@example.com", skipTicketEmail: true });
  expect(s.print).not.toHaveBeenCalled();
});
it("without consent, it charges with a one-sale email and never links the address", async () => {
  await withoutEmail(); await act(async () => charge.charge("cash"));
  expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => url === "/api/loyalty/card-email" && init?.method === "POST")).toHaveLength(0);
  expect(JSON.parse(post()[1]!.body as string).email).toBe("new@example.com");
});
it("a failed optional card save still charges the sale and keeps its per-sale email", async () => {
  await withoutEmail(); await act(async () => check("cardEmail.staffConsent")!.click());
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => url === "/api/loyalty/card-email" ? Promise.resolve(Response.json({}, { status: 503 })) : original(url, init));
  await act(async () => charge.charge("cash"));
  expect(post()).toBeTruthy(); expect(JSON.parse(post()[1]!.body as string).email).toBe("new@example.com");
  expect(s.toast).toHaveBeenCalledWith(t("cardEmail.saveFailed"), "error");
});
it("consent and skip do not follow a different card or a new sale", async () => {
  await act(async () => { details.setSkipTicketEmail(true); details.setSaveCardEmail(true); details.setEmailConsent(true); });
  await act(async () => details.setLoyaltyCard(null));
  expect(details.skipTicketEmail).toBe(false); expect(details.emailConsent).toBe(false); expect(details.saveCardEmail).toBe(false);
  await act(async () => { details.setSkipTicketEmail(true); details.setEmailConsent(true); });
  await act(async () => details.reset()); expect(details.skipTicketEmail).toBe(false); expect(details.emailConsent).toBe(false);
});
it("an unread card never falls back to sending a second address, and charging stays available", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).startsWith("/api/loyalty/card-email?") ? Promise.resolve(Response.json({}, { status: 503 })) : original(url, init));
  await act(async () => details.setLoyaltyCard({ code: "ABCD3XW9ABCD", suffix: "ABCD", progress: 1, goal: 8 }));
  await act(async () => details.setEmail("stale@example.com"));
  expect(host.querySelector('input[type="email"]')).toBeNull(); expect(check("cardEmail.skip")).toBeTruthy();
  await act(async () => check("cardEmail.skip")!.click()); await act(async () => charge.charge("cash"));
  expect(JSON.parse(post()[1]!.body as string)).toMatchObject({ skipTicketEmail: true });
  expect(JSON.parse(post()[1]!.body as string).email).toBeUndefined();
});
it("editing the email clears the previous consent", async () => {
  await withoutEmail(); await act(async () => check("cardEmail.staffConsent")!.click());
  await act(async () => details.setEmail("different@example.com"));
  expect(details.emailConsent).toBe(false);
  await act(async () => charge.charge("cash"));
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === "/api/loyalty/card-email" && init?.method === "POST")).toBe(false);
});
it("a duplicate card email explains which card to use and still charges", async () => {
  await withoutEmail(); await act(async () => check("cardEmail.staffConsent")!.click());
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => url === "/api/loyalty/card-email" ? Promise.resolve(Response.json({ outcome: "taken", suffix: "ABCD" }, { status: 409 })) : original(url, init));
  await act(async () => charge.charge("cash"));
  expect(post()).toBeTruthy(); expect(s.toast.mock.calls.some(([text]) => text.includes("···· ABCD"))).toBe(true);
});
it("offline charging preserves the skip choice without attempting an email save", async () => {
  await withoutEmail(); await act(async () => check("cardEmail.staffConsent")!.click());
  await act(async () => details.setSkipTicketEmail(true));
  vi.mocked(fetch).mockClear(); vi.stubGlobal("navigator", { onLine: false });
  await act(async () => charge.charge("cash"));
  expect(fetch).not.toHaveBeenCalled(); expect(replayBody(s.hold.mock.calls[0][0]).skipTicketEmail).toBe(true);
});
it("a lost card-save reply cannot send both a per-sale and an automatic ticket", async () => {
  await withoutEmail(); await act(async () => check("cardEmail.staffConsent")!.click());
  const original = vi.mocked(fetch).getMockImplementation()!;
  // The address may already be on the card even though the reply was lost.
  vi.mocked(fetch).mockImplementation((url, init) => url === "/api/loyalty/card-email" ? Promise.reject(new Error("lost after saving")) : original(url, init));
  await act(async () => charge.charge("cash"));
  expect(JSON.parse(post()[1]!.body as string)).toMatchObject({ email: "new@example.com", skipTicketEmail: true });
  expect(replayBody(s.hold.mock.calls[0][0]).skipTicketEmail).toBe(true);
});
