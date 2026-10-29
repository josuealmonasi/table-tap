// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import SettleTableDialog from "../SettleTableDialog";
import TableCalculator from "../TableCalculator";
import BillDiscountDialog from "../BillDiscountDialog";
import BillApprovals from "../BillApprovals";
import SplitWriteOffDialog from "../SplitWriteOffDialog";
import SettleAccountDialog from "../accounts/SettleAccountDialog";
import ChargeToAccountDialog from "../accounts/ChargeToAccountDialog";
import type { StaffSlotSplit } from "@/lib/split-slots-staff";
import type { Order } from "@/lib/types";
const s = vi.hoisted(() => ({ locale: "en" as "en" | "es", toast: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(s.locale), key, vars) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: s.refresh }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => s.toast }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
vi.mock("@/hooks/useCouponOptions", () => ({ useCouponOptions: () => ({ options: [], loading: false, failed: false }) }));
vi.mock("../CouponCodePicker", () => ({ default: ({ onCode }: { onCode: (s: string) => void }) => <button type="button" onClick={() => onCode("PROMO")}>Pick code</button> }));
vi.mock("../accounts/AccountPicker", () => ({ default: ({ onPick }: { onPick: (a: unknown) => void }) => <button onClick={() => onPick({ id: "account", name: "Ana" })}>Pick account</button> }));
let root: Root, host: HTMLDivElement;
const changed = vi.fn(), close = vi.fn();
const order = { id: "order", session_id: "session", total: 100, subtotal: 100, collected: 0, currency: "MXN", paid: false, status: "received", items: [] } as unknown as Order;
const bill = { key: "bill", tableId: "table", tableLabel: "1", code: null, customerName: null, orderIds: ["order"], items: [], total: 100, discount: 0, discounted: false, since: "2026-10-29" };
const split: StaffSlotSplit = { proposedBy: "phone", joined: 0, mine: null, ownSince: 0, id: "split", restaurantId: "restaurant", tableId: "table", sessionId: "session", modelVersion: 2, revision: 1, status: "locked", currency: "MXN", shares: 2, amount: 100, outstanding: 100, frozen: false, orderIds: ["order"], slots: [] };
const t = (key: string) => translate(messagesFor(s.locale), key);
const find = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text);
async function press(text: string) { const b = find(text); expect(b, text).toBeDefined(); await act(async () => b!.click()); }
const base = { open: true, onClose: close, currency: "MXN" };
const collection = { ...base, restaurantId: "restaurant", tableId: "table", tableLabel: "1", onSettled: changed, canApprove: true };
const approval = { id: "request", table_label: "1", amount: 100, requested_by: "Waiter" };
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  host = document.createElement("div"); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url, init) => {
    if (url === "/api/checkout/check") return Response.json({ outcome: "closed" });
    if (init) return Response.json({ error: "Unconfirmed", checkoutCode: "checkout_unresolved" }, { status: 409 });
    return Response.json({ orders: [order], splits: [], outstanding: { owed: 100, ordered: 100, collected: 0, tips: 0, currency: "MXN" } });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const cases = [
  { name: "table settlement", render: () => <SettleTableDialog {...collection} />, action: "settle.cash", endpoint: "/api/table-payment", scope: { kind: "table", tableId: "table", currency: "MXN" } },
  { name: "counter settlement", render: () => <SettleTableDialog {...collection} tableId={null} orderId="order" />, action: "settle.cash", endpoint: "/api/table-payment", scope: { kind: "orders", orderIds: ["order"] } },
  { name: "partial collection", render: () => <TableCalculator {...base} tableId="table" tableLabel="1" onCollected={changed} />, action: "settle.cash", endpoint: "/api/table-payment/part", scope: { kind: "table", tableId: "table", currency: "MXN" } },
  { name: "table write-off", render: () => <SettleTableDialog {...collection} />, prepare: "settle.writeOff", action: "writeOff.confirm", endpoint: "/api/bill/write-off", scope: { kind: "orders", orderIds: ["order"] } },
  { name: "promotion", render: () => <BillDiscountDialog {...base} bill={bill} canApprove onApplied={changed} />, prepare: "Pick code", action: "dash.billApplyCta", endpoint: "/api/bill/discount", scope: { kind: "table", tableId: "table", currency: "MXN" } },
  { name: "promotion write-off", render: () => <BillDiscountDialog {...base} bill={bill} canApprove onApplied={changed} />, prepare: "writeOff.title", action: "writeOff.confirm", endpoint: "/api/bill/write-off", scope: { kind: "orders", orderIds: ["order"] } },
  { name: "split write-off", render: () => <SplitWriteOffDialog split={split} orders={[order]} canApprove onApplied={changed} onClose={close} />, action: "writeOff.rest", endpoint: "/api/bill/write-off", scope: { kind: "orders", orderIds: ["order"] } },
  { name: "account settlement", render: () => <SettleAccountDialog {...base} accountId="account" name="Ana" owed={100} onSettled={changed} />, action: "settle.cash", endpoint: "/api/accounts/settle", scope: { kind: "account", accountId: "account" } },
  { name: "account transfer", render: () => <ChargeToAccountDialog {...base} orderIds={["order"]} amount={100} label="1" onCharged={changed} onRefresh={s.refresh} />, prepare: "Pick account", action: "accounts.chargeAction", endpoint: "/api/accounts/charge", scope: { kind: "orders", orderIds: ["order"] } },
  { name: "discount approval", render: () => <BillApprovals currency="MXN" requests={[{ ...approval, code: "PROMO" }]} writeOffs={[]} />, action: "dash.approve", endpoint: "/api/bill/discount/approve", scope: { kind: "approval", requestId: "request", requestKind: "discount" } },
  { name: "write-off approval", render: () => <BillApprovals currency="MXN" requests={[]} writeOffs={[{ ...approval, reason: "walkout", note: null }]} />, action: "writeOff.approve", endpoint: "/api/bill/write-off/approve", scope: { kind: "approval", requestId: "request", requestKind: "writeOff" } },
];
for (const locale of ["en", "es"] as const) it.each(cases)("$name checks only the refused scope, in " + locale, async c => {
  s.locale = locale;
  await act(async () => root.render(c.render()));
  expect(host.querySelector("[data-payment-check]")).toBeNull();
  if ("prepare" in c && c.prepare) await press(c.prepare.startsWith("Pick ") ? c.prepare : t(c.prepare));
  const action = find(t(c.action)) ?? [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith(t(c.action)));
  expect(action).toBeDefined();
  await act(async () => c.name === "promotion"
    ? host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) : action!.click());
  const before = vi.mocked(fetch).mock.calls.filter(([, init]) => init);
  expect(before.map(([url]) => url)).toEqual([c.endpoint]);
  expect(changed).not.toHaveBeenCalled();
  await press(t("paymentCheck.action"));
  const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init);
  expect(writes.map(([url]) => url)).toEqual([c.endpoint, "/api/checkout/check"]);
  expect(JSON.parse(writes[1][1]!.body as string)).toEqual(c.scope);
  expect(s.toast).toHaveBeenCalledWith(t("paymentCheck.closed"));
  expect(host.querySelectorAll("[role=dialog]").length).toBeLessThanOrEqual(1);
});
