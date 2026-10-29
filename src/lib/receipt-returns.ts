import type { ReturnComponents } from "@/lib/return-components";
import { formatMoney } from "@/lib/format";
import { receiptCents as cents } from "@/lib/receipt-amount";

export interface ReceiptReturn {
  returned_cents?: number;
  id: string; source: string; amount: number; tip: number; status: string; completed_at: string | null;
}
export interface ReturnedReceipt {
  total: number | string; currency: string;
  return_components?: ReturnComponents;
  returns?: ReceiptReturn[];
}

/** A cash part still waiting for confirmation cannot look like a card part
 * already given back. Keep the promise and the completed money separate. */
export function receiptReturnRows(orders: ReturnedReceipt[], t: (key: string) => string): [string, string][] {
  const operations = orders.flatMap(o => o.returns ?? []);
  if (!operations.length) return [];
  const currency = orders[0].currency;
  const retained = orders.reduce((sum, o) => sum + cents(o.total), 0);
  const original = retained + orders.reduce((sum, o) => sum + cents(o.return_components?.total ?? 0), 0);
  const given = (o: ReceiptReturn) => o.returned_cents ?? (o.status === "succeeded" ? cents(o.amount) : 0);
  const completed = operations.reduce((sum, o) => sum + given(o), 0);
  const pending = operations.reduce((sum, o) => sum + cents(o.amount) - given(o), 0);
  if (original !== retained + completed + pending) throw new Error("The receipt's returns do not reconcile");
  const rows: [string, string][] = [[t("receipt.original"), formatMoney(original / 100, currency)],
    [t("receipt.returned"), formatMoney(completed / 100, currency)],
    [t("receipt.returnPending"), formatMoney(pending / 100, currency)]];
  for (const operation of operations) {
    const returned = given(operation), remaining = cents(operation.amount) - returned;
    if (returned > 0) rows.push([`${t("receipt.returned")} · ${t(`returns.${operation.source}`)}`, formatMoney(returned / 100, currency)]);
    if (remaining > 0) rows.push([`${t("receipt.returnPending")} · ${t(`returns.${operation.source}`)}`, formatMoney(remaining / 100, currency)]);
  }
  return rows;
}
