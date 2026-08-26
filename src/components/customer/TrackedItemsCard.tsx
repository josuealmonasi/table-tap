"use client";

import { formatMoney } from "@/lib/format";
import { lineUnitPrice, type OrderLineItem } from "@/lib/types";
import { useT } from "@/lib/i18n/context";

/** Read-only summary of what was ordered, shown on the tracking screen. */
export default function TrackedItemsCard({
  items,
  total,
  currency,
  paid = true,
}: {
  items: OrderLineItem[];
  total: number;
  currency: string;
  /** Falso en una cuenta que se paga al final o en la caja. */
  paid?: boolean;
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
        {/* Un pedido que se paga en la mesa o en la caja todavía no está
            pagado, y decirle "Total pagado" al comensal es decirle que ya
            saldó algo que va a tener que saldar. */}
        <span>{t(paid ? "tracker.totalPaid" : "tracker.totalDue")}</span>
        <span className="tt-price">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}
