"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { OpenBill } from "@/lib/open-bills";

/** An open bill's lines and total, as the floor reads them at the table. */
export default function OpenBillSummary({
  bill,
  currency,
}: {
  bill: OpenBill;
  currency: string;
}) {
  const t = useT();
  return (
    <>
      <h3 className="tt-serif" style={{ marginTop: 0 }}>
        {bill.tableLabel
          ? t("dash.tableN", { label: bill.tableLabel })
          : t("dash.billsToGo")}
      </h3>

      {bill.items.map((item, i) => (
        <div key={i} className="tt-row tt-muted" style={{ fontSize: 14, marginTop: 6 }}>
          <span>
            {item.qty}× {item.name}
          </span>
          <span>{formatMoney(item.price * item.qty, currency)}</span>
        </div>
      ))}

      {/* When a promotion is already on this bill the lines add up to more
          than the total, so the difference is named rather than left for the
          waiter to explain to the table. Same three rows the diner sees. */}
      {bill.discount > 0 && (
        <>
          <div className="tt-row" style={{ marginTop: 12, fontSize: 14 }}>
            <span className="tt-muted">{t("totals.subtotal")}</span>
            <span className="tt-muted">
              {formatMoney(bill.total + bill.discount, currency)}
            </span>
          </div>
          <div className="tt-row" style={{ marginTop: 4, fontSize: 14 }}>
            <span className="tt-save">{t("totals.discount")}</span>
            <span className="tt-save">−{formatMoney(bill.discount, currency)}</span>
          </div>
        </>
      )}

      <div className="tt-row tt-total" style={{ marginTop: 12 }}>
        <span>{t("totals.total")}</span>
        <span>{formatMoney(bill.total, currency)}</span>
      </div>
    </>
  );
}
