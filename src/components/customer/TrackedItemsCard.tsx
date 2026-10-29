"use client";

import { formatMoney } from "@/lib/format";
import { lineUnitPrice, type OrderLineItem } from "@/lib/types";
import type { TrackedReturnSummary } from "@/lib/order-tracking";
import { useT } from "@/lib/i18n/context";

/** Read-only summary of what was ordered, shown on the tracking screen. */
export default function TrackedItemsCard({
  items,
  total,
  currency,
  paid = true,
  returnSummary,
}: {
  items: OrderLineItem[];
  total: number;
  currency: string;
  /** False on a bill paid at the end or at the till. */
  paid?: boolean;
  returnSummary?: TrackedReturnSummary;
}) {
  const t = useT();
  return (
    <div className="tt-card" style={{ padding: 16, marginTop: 16 }}>
      <strong>{t("tracker.yourItems")}</strong>
      <div style={{ marginTop: 12 }}>
        {items.map((item, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div className="tt-row" style={{ fontSize: 14 }}>
              <span>
                {item.qty}× {item.emoji || "🍽️"} {item.name}
              </span>
              <span className="tt-muted">
                {formatMoney(lineUnitPrice(item) * item.qty, currency)}
              </span>
            </div>
            {item.extras && item.extras.length > 0 && (
              <div className="tt-muted tt-subline" style={{ fontSize: 12, paddingLeft: 18 }}>
                + {item.extras.map(e => e.name).join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="tt-row tt-total">
        {/* An order settled at the table or at the till is not paid yet, and
            calling it "Total paid" tells the diner they have already settled
            something they are still going to have to settle. */}
        <span>{t(paid ? "tracker.totalPaid" : "tracker.totalDue")}</span>
        <span className="tt-price">{formatMoney(returnSummary?.paid ?? total, currency)}</span>
      </div>
      {returnSummary && <>
        <div className="tt-row tt-total">
          <span>{t("tracker.returned")}</span>
          <span className="tt-price">{formatMoney(returnSummary.returned, currency)}</span>
        </div>
        <div className="tt-row tt-total">
          <span>{t("tracker.returnPending")}</span>
          <span className="tt-price">{formatMoney(returnSummary.pending, currency)}</span>
        </div>
      </>}
    </div>
  );
}
