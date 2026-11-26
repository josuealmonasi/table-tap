// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { usePosCharge } from "../usePosCharge";
import { useOfflineSales } from "../useOfflineSales";
import { readHeld } from "@/lib/offline-sales";
import { messagesFor, translate } from "@/lib/i18n";

// bl39 finding 2: the till saves the shift it had open with every cash sale
// it holds, so a late upload is recorded in the drawer that took the money.
const state = vi.hoisted(() => ({ router: { refresh: vi.fn() }, shift: undefined as string | undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
// Stable across renders, as the real one is: a new function each render loops the till's effects.
const i18n = vi.hoisted(() => ({ t: null as unknown, locale: { locale: "en" } }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => i18n.t, useLocale: () => i18n.locale }));
i18n.t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars);
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/lib/pos-last-sale", () => ({ rememberLastSale: vi.fn() }));
let till: ReturnType<typeof usePosCharge>, root: Root;
function Harness() {
  const offline = useOfflineSales("r");
  till = usePosCharge({ collector: "cashier", collectorContext: "signed", cashShiftId: state.shift, restaurant: { id: "r", name: "Cafe", currency: "MXN" },
    cart: { lines: [{ itemId: "dish", name: "Soup", emoji: "", mods: {}, price: 100, qty: 1 }], clear: vi.fn() },
    details: { tipPct: 0, tipCustom: null, noTicket: true, customerName: "", note: "", email: "", terminalRef: "", reset: vi.fn() },
    offline, canEmailReceipt: false, pricing: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100, lines: [{ itemId: "dish", qty: 1, gross: 100, unit: 100 }], promoSavings: {} },
  } as unknown as Parameters<typeof usePosCharge>[0]);
  return null;
}
async function mount(shift: string | undefined): Promise<void> {
  state.shift = shift;
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { onLine: false }); localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("a cash sale taken offline keeps the shift the till had open", async () => {
  await mount("shift-a");
  await act(async () => till.charge("cash"));
  expect(readHeld()[0]).toMatchObject({ method: "cash", cashShiftId: "shift-a" });
});

it("a card sale names no shift, and neither does a till with no shift open", async () => {
  await mount("shift-a");
  await act(async () => till.charge("card"));
  expect(readHeld()[0]?.cashShiftId).toBeUndefined();
  await act(async () => root.unmount());
  localStorage.clear();
  await mount(undefined);
  await act(async () => till.charge("cash"));
  expect(readHeld()[0]?.cashShiftId).toBeUndefined();
});

it("Held sales asks the manager to confirm the shift, the one it was taken in first", async () => {
  const { default: RecoveryForm } = await import("@/components/dashboard/pos/RecoveryForm");
  const sale = { posRef: "sale", restaurantId: "r", at: "2026-11-25T11:59:00Z", method: "cash" as const, currency: "MXN", cashShiftId: "A",
    items: [], charge: { subtotal: 80, serviceFee: 0, tip: 0, discount: 0, total: 80 }, error: "apiErr.offlineShiftClosed" };
  const shifts = { taken: { id: "A", opened_at: "2026-11-25T08:00:00Z", closed_at: "2026-11-25T12:00:00Z" }, open: { id: "B", opened_at: "2026-11-25T12:01:00Z", closed_at: null } };
  const html = renderToStaticMarkup(<RecoveryForm sale={sale} shifts={shifts} currentCurrency="MXN" busy={false} onClose={() => {}} onSubmit={() => {}} />);
  expect(html).toContain("The cash shift this sale was collected in closed");
  expect(html).toContain("Cash shift");
  expect(html).toMatch(/checked=""[^>]*\/> Shift it was collected in/);
  expect(html).toContain("Open shift (since");
  const none = renderToStaticMarkup(<RecoveryForm sale={sale} shifts={{ taken: null, open: null }} currentCurrency="MXN" busy={false} onClose={() => {}} onSubmit={() => {}} />);
  expect(none).toContain("Open a cash shift to approve it.");
});
