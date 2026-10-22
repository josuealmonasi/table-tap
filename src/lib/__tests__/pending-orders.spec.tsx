import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { pendingHarness } from "./pending-ui-harness";
import type { useCartTotals } from "@/hooks/useCartTotals";
import type { usePosCart } from "@/hooks/usePosCart";
import type { AccountListItem } from "@/hooks/useOpenAccounts";
import type { Category, MenuItem } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
const state = vi.hoisted(() => ({ ui: null as unknown as ReturnType<typeof pendingHarness>, fetch: vi.fn(), cart: null as unknown as Pick<ReturnType<typeof usePosCart>, "lines" | "clear" | "changeQty"> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (v: unknown) => state.ui.useState(v), useRef: (v: unknown) => state.ui.useRef(v),
  useMemo: (fn: () => unknown) => fn(), useLayoutEffect: vi.fn(), useContext: () => null, useEffect: vi.fn(), useCallback: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (k: string, v?: object) => k + (v ? JSON.stringify(v) : ""), useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/hooks/useLiveStock", () => ({ useLiveStock: vi.fn() }));
vi.mock("@/hooks/usePosCart", () => ({ usePosCart: () => state.cart }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ ConfirmProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/dashboard/QrScanner", () => ({ default: () => <button>Scan</button> }));
vi.mock("@/components/customer/CartLineRow", () => ({ default: ({ item, onChangeQty }: { item: CartItem; onChangeQty: (id: number, qty: number) => void }) => <label>{item.name}<input value={item.qty} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChangeQty(item.cartId, Number(e.target.value))} /></label> }));
vi.mock("@/components/dashboard/pos/PosAccountCharge", () => ({ default: () => <button>Pick account</button> }));
vi.mock("@/lib/usual", () => ({ rememberUsual: vi.fn() }));
vi.mock("@/lib/my-orders", () => ({ rememberMyOrder: vi.fn() }));
vi.mock("@/lib/recent-order", () => ({ rememberRecentOrder: vi.fn() }));
vi.mock("@/lib/upsell", () => ({ clearUpsell: vi.fn() }));
vi.mock("@/lib/diner-name", () => ({ rememberDinerName: vi.fn() }));
vi.mock("@/lib/diner-token", () => ({ dinerToken: () => "phone" }));
vi.mock("@/lib/pos-last-sale", () => ({ rememberLastSale: vi.fn() }));
import TableOrderScreen from "@/components/dashboard/waiter/TableOrderScreen";
import PosSalePanel from "@/components/dashboard/pos/PosSalePanel";
import CartOverlay from "@/components/customer/CartOverlay";
import { useCheckout } from "@/hooks/useCheckout";
import { useCart } from "@/hooks/useCart";
import { usePosCharge } from "@/hooks/usePosCharge";
import type { Restaurant } from "@/lib/types";
const restaurant = { id: "r", currency: "MXN", accepting_orders: true, service_pct: 0 } as Restaurant;
const line = { cartId: 1, itemId: "food", name: "Soup", emoji: "", price: 50, qty: 1, mods: {}, extras: [] } as CartItem;
const bodies = () => state.fetch.mock.calls.map(c => JSON.parse(c[1].body));
beforeEach(() => {
  vi.stubGlobal("React", React); state.ui = pendingHarness(); state.fetch.mockReset(); vi.stubGlobal("fetch", state.fetch); vi.stubGlobal("navigator", { onLine: true });
  state.fetch.mockRejectedValueOnce(new Error("lost reply"));
  state.cart = { lines: [{ ...line }], clear: vi.fn(() => { state.cart.lines = []; }), changeQty: vi.fn((_: number, qty: number) => { state.cart.lines = [{ ...line, qty }]; }) };
});
async function click(text: string) {
  const button = state.ui.all("button").find(n => n.text.includes(text))!;
  expect(button, text).toBeDefined(); expect(button.disabled, text).toBe(false);
  await button.props.onClick!(); await new Promise(resolve => setImmediate(resolve)); state.ui.render();
}
it("S20b waiter pad locks the frozen cart and retries it even after menus close", async () => {
  let closedNow = false;
  state.ui.render(() => <TableOrderScreen restaurant={restaurant} categories={[{ id: "cat", name: "Food" }] as Category[]} items={[{ id: "food", category_id: "cat", name: "Soup", available: true, price: 50 }] as MenuItem[]} extras={[]} extrasByProduct={{}} promos={[]} combos={[]} closedNow={closedNow} dietaryTags={[]} tables={[{ id: "t", label: "One" }]} />);
  state.ui.change(state.ui.all("select")[0], "t"); await click("waiter.send");
  expect(state.ui.text()).toContain("pending.order"); expect(state.ui.all("button").find(n => n.props.className === "tt-pos-tile ")!.disabled).toBe(true);
  const qty = state.ui.all("input").find(n => n.props.value === 1)!;
  expect(qty.disabled).toBe(true); state.ui.change(qty, "2"); expect(state.cart.changeQty).not.toHaveBeenCalled();
  expect(state.ui.all("select")[0].disabled).toBe(true); expect(state.ui.all("button").some(n => n.text === "Scan")).toBe(false);
  closedNow = true; state.ui.render(); state.fetch.mockResolvedValueOnce(Response.json({ orderId: "o", code: "A", table: "One" }));
  await click("pending.sendAgain"); expect(bodies()[1]).toEqual(bodies()[0]); expect(state.cart.clear).toHaveBeenCalledOnce();
});
it("S20b diner sees the frozen order and newly added food survives its retry", async () => {
  let cart!: ReturnType<typeof useCart>, checkout!: ReturnType<typeof useCheckout>;
  function Subject() {
    cart = useCart("r");
    checkout = useCheckout({ restaurantId: "r", table: null, orderableItems: cart.items, orderNote: "No salt", customerName: "Ana", tipPct: 0, tipCustom: null, coupon: null,
      cart, dropCoupon: vi.fn(), markSoldOut: vi.fn(), notify: vi.fn(), onPlaced: vi.fn() });
    return <CartOverlay restaurant={restaurant} table={null} cart={cart} totals={{ pricing: { subtotal: 50, grossSubtotal: 50, total: 50, discount: 0, tip: 0, serviceFee: 0, hints: [], promoSavings: {} }, orderableItems: cart.items, soldOut: new Set(), tipPct: 0, tipCustom: null, coupon: null } as unknown as ReturnType<typeof useCartTotals>}
      pendingOrder={checkout.frozen} photoOf={() => null} suggestions={[]} orderNote="No salt" onChangeNote={vi.fn()} customerName="Ana" loading={checkout.loading} onEditItem={vi.fn()} onCheckout={checkout.checkout} onClose={vi.fn()} />;
  }
  state.ui.render(() => <Subject />); cart.addItem(line); state.ui.render(); await checkout.checkout(true); state.ui.render();
  expect(state.ui.text()).toContain("pending.sendAgain"); expect(state.ui.text()).toContain("Soup"); expect(state.ui.text()).toContain("No salt");
  cart.addItem({ ...line, itemId: "bread", name: "Bread" }); cart.addItem(line); state.ui.render();
  expect(state.ui.text()).toContain("pending.moreFood");
  expect(state.ui.text()).toContain("1 × Soup"); expect(state.ui.text()).not.toContain("Bread");
  state.fetch.mockResolvedValueOnce(Response.json({ orderId: "o", deferred: true })); await click("pending.sendAgain");
  expect(bodies()[1]).toEqual(bodies()[0]); expect(cart.items.map(i => [i.name, i.qty])).toEqual([["Soup", 1], ["Bread", 1]]);
  expect(checkout.frozen).toBeNull();
  state.fetch.mockResolvedValueOnce(Response.json({ orderId: "next", deferred: true })); await checkout.checkout(true); state.ui.render();
  expect(bodies()[2].ref).not.toBe(bodies()[0].ref); expect(bodies()[2].items.map((i: CartItem) => i.itemId)).toEqual(["food", "bread"]);
  expect(cart.items).toHaveLength(0);
});
it("S20b POS names the frozen account and amount before any cash or card choice", async () => {
  let till!: ReturnType<typeof usePosCharge>;
  const details = { tipPct: 0, tipCustom: null, noTicket: true, customerName: "Ana", note: "No salt", reset: vi.fn() };
  const pricing = { subtotal: 50, total: 50, serviceFee: 0, tip: 0, discount: 0 };
  function Subject() {
    till = usePosCharge({ restaurant, collector: "C", collectorContext: "signed", cart: state.cart, details, pricing, canEmailReceipt: false,
      offline: { hold: vi.fn(), acknowledge: vi.fn(), discard: vi.fn(), setOnline: vi.fn() } } as unknown as Parameters<typeof usePosCharge>[0]);
    return <PosSalePanel lines={state.cart.lines} items={[]} currency="MXN" total={pricing.total} accountAmount={50} locked={till.busy} canChargeAccount
      accountRetry={till.accountRetry} onRetryAccount={() => till.charge("account")} onChangeQty={state.cart.changeQty} onEdit={vi.fn()} onCharge={till.setPending} onChargeAccount={a => till.charge("account", a)} />;
  }
  state.ui.render(() => <Subject />); await till.charge("account", { id: "a", name: "Ana's tab" } as AccountListItem); state.ui.render();
  expect(state.ui.text()).toContain("Ana's tab"); expect(state.ui.text()).toContain("MX$50"); expect(state.ui.text()).toContain("Soup");
  expect(state.ui.text()).not.toContain("pos.chargeCash"); expect(state.ui.text()).not.toContain("pos.chargeCard"); expect(state.ui.text()).not.toContain("Pick account");
  expect(state.ui.all("input")).toHaveLength(0); expect(state.ui.all("select")).toHaveLength(0);
  state.fetch.mockResolvedValueOnce(Response.json({ error: "refused", retryUncommitted: true }, { status: 409 })); await click("pending.sendAgain");
  expect(bodies()[1]).toEqual(bodies()[0]); expect(till.accountRetry).toBeNull(); expect(state.ui.text()).toContain("pos.chargeCash");
});
