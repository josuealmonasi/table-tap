import { beforeEach, expect, it, vi } from "vitest";
import { checkAccountCredits } from "../../../scripts/money-account-credits.mjs";
import { receiptCents } from "@/lib/receipt-amount";
const bad = vi.fn();
const adjustment = (id: string, previous: number, resulting: number) => ({ id, kind: "account_credit", order_id: "o", restaurant_id: "r",
  previous_total: previous, resulting_total: resulting, previous_tip: 0, resulting_tip: 0, previous_service_fee: 0, resulting_service_fee: 0,
  forgiven: previous - resulting, amount_cents: (previous - resulting) * 100, currency: "MXN", reason: "error", request_id: id, request: {} });
const event = (id: string, amount: number) => ({ id, restaurant_id: "r", entity: "bill", action: "written_off",
  detail: `kind=account_credit amount=${amount} currency=MXN reason=error` });
const order = { id: "o", restaurant_id: "r", account_id: "account", total: 0, paid: false, written_off: true, status: "completed" };
beforeEach(() => bad.mockClear());
it("accepts several partial credits followed by full relief without requiring payment coverage", () => {
  checkAccountCredits([adjustment("a", 50, 30), adjustment("b", 30, 0)], [order], [event("a", 20), event("b", 30)], receiptCents, bad);
  expect(bad).not.toHaveBeenCalled();
});
it("allows subsequent collection plus tip without counting the credit as a payment", () => {
  checkAccountCredits([adjustment("a", 50, 30)], [{ ...order, total: 35, paid: true, written_off: false }], [event("a", 20)], receiptCents, bad);
  expect(bad).not.toHaveBeenCalled();
});
it.each(["amount", "missing event", "wrong currency", "debt", "duplicate", "written_off"])("rejects %s sabotage", fault => {
  const a = adjustment("a", 50, 0), o = { ...order }, logs = [event("a", 50)];
  if (fault === "amount") a.amount_cents = 10;
  if (fault === "missing event") logs.length = 0;
  if (fault === "wrong currency") a.currency = "USD";
  if (fault === "debt") o.total = 10;
  if (fault === "written_off") o.written_off = false;
  checkAccountCredits(fault === "duplicate" ? [a, a] : [a], [o], logs, receiptCents, bad);
  expect(bad).toHaveBeenCalled();
});
