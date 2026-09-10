"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { PAID_LINES_SHOWN, type TableBill } from "@/lib/table-bill";

interface SettleBillLinesProps {
  bill: TableBill;
  currency: string;
}

/**
 * What the table ordered, what somebody already paid for, and the total.
 *
 * The reading half of the settle dialog, lifted out so the dialog itself is
 * the three buttons and the decisions behind them.
 */
export default function SettleBillLines({ bill, currency }: SettleBillLinesProps) {
  const t = useT();
  // Folded by default: what was paid is reference, the total is what they came for.
  const [showPaid, setShowPaid] = useState(false);

  return (
    <>
      <div className="tt-mod-label">{t("settle.items")}</div>
      {bill.others.items.concat(bill.mine.items).map((item, i) => (
        <div key={i} className="tt-muted tt-subline" style={{ fontSize: 13 }}>
          {item.qty}× {item.emoji} {item.name}
        </div>
      ))}

      {/* What somebody at the table already paid by card. Apart, and not
          added in: the waiter needs to know that dish is not being charged
          for, and hiding it is exactly what leads to charging twice. */}
      {bill.paid.orders.length > 0 && (
        <div className="tt-bill-settled" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="tt-mod-label tt-paid-toggle"
            aria-expanded={showPaid}
            onClick={() => setShowPaid(v => !v)}
          >
            {t("settle.alreadyPaid", {
              amount: formatMoney(bill.paid.total, currency),
            })}
            {bill.paid.items.length > PAID_LINES_SHOWN && (
              <span className="tt-muted">
                {" "}
                {t(showPaid ? "settle.hideLines" : "settle.showLines", {
                  n: bill.paid.items.length,
                })}
              </span>
            )}
          </button>
          {(showPaid ? bill.paid.items : bill.paid.items.slice(0, PAID_LINES_SHOWN)).map(
            (item, i) => (
              <div key={i} className="tt-muted tt-subline" style={{ fontSize: 13 }}>
                {item.qty}× {item.emoji} {item.name}
              </div>
            ),
          )}
        </div>
      )}

      <div className="tt-bill-total tt-row">
        <strong>{t("settle.total")}</strong>
        <strong style={{ fontSize: 18 }}>{formatMoney(bill.total, currency)}</strong>
      </div>
    </>
  );
}
