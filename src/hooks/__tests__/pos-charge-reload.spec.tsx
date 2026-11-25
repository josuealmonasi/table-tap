// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePosCharge } from "../usePosCharge";
import { usePosCart } from "../usePosCart";
import { MAX_TILL_LINES } from "@/lib/cart-limits";
import { readHeld } from "@/lib/offline-sales";

const state = vi.hoisted(() => ({ router: { refresh: vi.fn() }, t: (key: string) => key, toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => state.t, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/lib/pos-last-sale", () => ({ rememberLastSale: vi.fn() }));

const CART = "tt-pos-cart:r";
const dish = { itemId: "dish", name: "Soup", emoji: "", mods: {}, price: 100, qty: 1, cartId: 1 };
let till: ReturnType<typeof usePosCharge>, cart: ReturnType<typeof usePosCart>, root: Root;
const held: unknown[] = [];

function Harness() {
  cart = usePosCart("r", true, MAX_TILL_LINES);
  till = usePosCharge({ collector: "cashier", collectorContext: "signed", restaurant: { id: "r", name: "Cafe", currency: "MXN" },
    cart, details: { tipPct: 0, tipCustom: null, noTicket: true, customerName: "", note: "", email: "", terminalRef: "", reset: vi.fn() },
    offline: { hold: (s: unknown) => { held.push(s); return true; }, acknowledge: () => true, discard: vi.fn(), setOnline: vi.fn() },
    canEmailReceipt: false, pricing: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100, lines: [{ itemId: "dish", qty: 1, gross: 100, unit: 100 }], promoSavings: {} },
  } as unknown as Parameters<typeof usePosCharge>[0]);
  return null;
}
async function mount(): Promise<void> {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
}
/** A reload: the page goes, the device's storage stays. */
async function reload(): Promise<void> {
  await act(async () => root.unmount());
  await mount();
}
const sentBodies = () => vi.mocked(fetch).mock.calls.map(c => (c[1] as RequestInit).body as string);

beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { onLine: true }); localStorage.clear(); held.length = 0; state.toast.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  localStorage.setItem(CART, JSON.stringify([dish]));
  await mount();
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("bl39 #1: an account charge lost in flight is retried after a reload with the same request and reference", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("lost"));
  await act(async () => till.charge("account", { id: "acc", name: "Ana" } as never));
  expect(localStorage.getItem(`${CART}:account`)).not.toBeNull();
  await reload();
  // The panel offers the unconfirmed charge again rather than a fresh one.
  expect(till.accountRetry).toMatchObject({ name: "Ana", amount: 100 });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ settled: true, onAccount: { name: "Ana" }, total: 100, code: "A1" }));
  await act(async () => till.charge("cash"));
  const [first, retry] = sentBodies();
  expect(retry).toBe(first);
  expect(JSON.parse(retry)).toMatchObject({ method: "account", accountId: "acc" });
  // Answered: nothing is left to retry, here or after another reload.
  expect(localStorage.getItem(`${CART}:account`)).toBeNull();
  await reload();
  expect(till.accountRetry).toBeNull();
});

it("bl39 #1: the account request is on the device before the request leaves", async () => {
  let storedWhenSent: string | null = null;
  vi.mocked(fetch).mockImplementationOnce(async () => {
    storedWhenSent = localStorage.getItem(`${CART}:account`);
    throw new Error("lost");
  });
  await act(async () => till.charge("account", { id: "acc", name: "Ana" } as never));
  expect(JSON.parse(storedWhenSent!).request).toBe(sentBodies()[0]);
});

it("bl39 #1: a stalled cash body keeps the charging marker, so a reload leaves the held sale to replay", async () => {
  const stalled = new Response(null, { status: 200 });
  vi.spyOn(stalled, "json").mockReturnValue(new Promise(() => {}));
  vi.mocked(fetch).mockResolvedValueOnce(stalled);
  await act(async () => { void till.charge("cash"); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(localStorage.getItem(`${CART}:charging`)).toBe((held[0] as { posRef: string }).posRef);
  await reload();
  expect(cart.lines).toEqual([]);
});

it("bl39 #1: a settled cash sale clears the cart and the marker together", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: "B1", total: 100, settled: true }));
  await act(async () => till.charge("cash"));
  expect(localStorage.getItem(CART)).toBeNull();
  expect(localStorage.getItem(`${CART}:charging`)).toBeNull();
});

it("bl39 #1: a refused cash sale keeps the cart to fix and drops the marker", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "closed" }, { status: 409 }));
  await act(async () => till.charge("cash"));
  expect(localStorage.getItem(`${CART}:charging`)).toBeNull();
  expect(cart.lines).toHaveLength(1);
});

it("bl39 #4: a cart over the till limit is refused before payment is asked or a sale held", async () => {
  const lines = Array.from({ length: MAX_TILL_LINES + 1 }, (_, i) => ({ ...dish, itemId: `d${i}`, cartId: i + 1 }));
  localStorage.setItem(CART, JSON.stringify(lines));
  await reload();
  await act(async () => till.setPending("cash"));
  expect(till.pending).toBeNull();
  await act(async () => till.charge("cash"));
  expect(fetch).not.toHaveBeenCalled();
  expect(held).toEqual([]);
  expect(readHeld()).toEqual([]);
  expect(state.toast).toHaveBeenCalledWith("pos.tooManyLines", "error");
});
