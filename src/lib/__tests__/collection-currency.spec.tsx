import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { tableBill } from "@/lib/table-bill";
import type { Order, Restaurant } from "@/lib/types";

const state = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
vi.stubGlobal("React", React);
vi.mock("react", async original => ({ ...await original<typeof React>(), useState: (initial: unknown) => {
  const n = state.index++;
  return [n in state.values ? state.values[n] : typeof initial === "function" ? initial() : initial, vi.fn()];
} }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: "en" }), useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useBillPayment", () => ({ useBillPayment: () => ({}) }));
vi.mock("@/hooks/useSplit", () => ({ useSplit: () => ({ split: null }) }));
vi.mock("@/components/customer/TipPicker", () => ({ default: ({ currency }: { currency: string }) => <span>Tip currency: {currency}</span> }));
import TableCalculator from "@/components/dashboard/TableCalculator";
import BillSheet from "@/components/customer/BillSheet";
import AccountStatement from "@/components/accounts/AccountStatement";
import { openBills } from "@/lib/open-bills";
import { tableStatuses } from "@/lib/table-status";
import SplitBillCard from "@/components/customer/SplitBillCard";
import type { SplitState } from "@/hooks/useSplit";
import SettleBillLines from "@/components/dashboard/SettleBillLines";

beforeEach(() => { state.index = 0; state.values = []; });
it("S21 calculator offers the same MX$20 ceiling as applyPayment for ten plus fifty", () => {
  state.values = [{ ordered: 100, owed: 100, collected: 0, tips: 0, currency: "MXN" }, "amount", [], 0, "10", 0, 50];
  const html = renderToStaticMarkup(<TableCalculator open onClose={vi.fn()} tableId="t" tableLabel="1" currency="MXN" onCollected={vi.fn()} />);
  expect(html).toContain("MX$20.00");
  expect(html).not.toContain("MX$60.00");
  expect(html).toContain("role=\"alert\"");
});
it("S21 a US$100 bill and its tip picker keep USD beside an MXN menu", () => {
  const order = { id: "o", currency: "USD", total: 100, tip: 0, status: "received", paid: false, items: [] } as unknown as Order;
  const html = renderToStaticMarkup(<BillSheet open onClose={vi.fn()} bill={tableBill([order], ["o"])} restaurant={{ id: "r", currency: "MXN", cards_enabled: true } as Restaurant} tableId="t" tableLabel="1" photoOf={() => null} />);
  expect(html).toContain("$100.00");
  expect(html).toContain("Tip currency: USD");
  expect(html).not.toContain("MX$100.00");
});

it("S21 a mixed bill, open-bill list and table status keep two debts instead of two hundred", () => {
  const orders = ["USD", "MXN"].map((currency,i) => ({ id: `o${i}`, table_id: "t", currency, total: 100, tip: 0, status: "received", paid: false, items: [], created_at: "2026-10-21" }) as unknown as Order);
  const bill = tableBill(orders, []);
  expect(bill.total).toBe(0);
  expect(openBills(orders).map(b => [b.currency,b.total])).toEqual([["USD",100],["MXN",100]]);
  expect(tableStatuses(orders).get("t")).toMatchObject({ owed: 0, balances: [{ currency: "USD",amount: 100 }, { currency: "MXN",amount: 100 }] });
  const html = renderToStaticMarkup(<BillSheet open onClose={vi.fn()} bill={bill} restaurant={{ id: "r", currency: "MXN", cards_enabled: true } as Restaurant} tableId="t" tableLabel="1" photoOf={() => null} />);
  expect(html).toContain("$100.00"); expect(html).toContain("MX$100.00"); expect(html).not.toContain("$200.00");
});

it("S21 account payment, tips, history and its printed statement use saved currencies", () => {
  state.values = [{ restaurant: { id: "r", name: "Cafe", currency: "MXN" }, name: "Diner", status: "open", owed: 100,
    currency: "USD", balances: [{ currency: "USD", amount: 100 }], days: [],
    payments: [{ at: "2026-10-21T12:00:00Z", amount: 50, tip: 0, method: "cash", currency: "USD" }],
    cardsEnabled: true, payingOnline: false, canEmail: false, timeZone: "UTC" }, null, "online", 10];
  const html = renderToStaticMarkup(<AccountStatement code="account-code" paid={false} />);
  expect(html).toContain("$100.00"); expect(html).toContain("$110.00"); expect(html).toContain("$50.00");
  expect(html).toContain("Tip currency: USD"); expect(html).not.toContain("MX$100.00");
});

it("S21 a split's pay button includes the same ten-percent tip as its card charge", () => {
  const html = renderToStaticMarkup(<SplitBillCard split={{ status: "locked", mine: { amount: 50 }, ownSince: 0, shares: 2 } as SplitState}
    diner="d" busy={false} currency="MXN" outstanding={100} party={2} cardsEnabled
    propose={vi.fn()} join={vi.fn()} cancel={vi.fn()} onPay={vi.fn()} {...{ tipPct: 10 }} />);
  expect(html).toContain("MX$55.00");
});

it("S21 an older paid peso order does not prevent splitting a dollar debt", () => {
  const orders = [{ id: "owed",currency: "USD",total: 100,paid: false },{ id: "paid",currency: "MXN",total: 50,paid: true }]
    .map(o => ({ ...o,tip: 0,status: "completed",items: [] }) as unknown as Order);
  const html = renderToStaticMarkup(<BillSheet open onClose={vi.fn()} bill={tableBill(orders,["owed"])} restaurant={{ id: "r",currency: "MXN",cards_enabled: true } as Restaurant}
    tableId="t" tableLabel="1" party={2} photoOf={() => null} />);
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("MX$50.00");
});

it("S21 the staff's paid history keeps its currencies beside the current debt", () => {
  const orders = [{ id: "owed",currency: "USD",total: 100,paid: false },{ id: "paid",currency: "MXN",total: 50,paid: true }]
    .map(o => ({ ...o,tip: 0,status: "completed",items: [] }) as unknown as Order);
  const html = renderToStaticMarkup(<SettleBillLines bill={tableBill(orders,[])} currency="USD" />);
  expect(html).toContain("MX$50.00"); expect(html).toContain("$100.00");
});
