import { formatMoney } from "@/lib/format";
import { lineUnitPrice, type OrderLineItem } from "@/lib/types";

/** Read-only summary of what was ordered, shown on the tracking screen. */
export default function TrackedItemsCard({
  items,
  total,
  currency,
}: {
  items: OrderLineItem[];
  total: number;
  currency: string;
}) {
  return (
    <div className="tt-card" style={{ padding: 16, marginTop: 16 }}>
      <strong>Your items</strong>
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
              <div className="tt-muted" style={{ fontSize: 12, paddingLeft: 18 }}>
                + {item.extras.map(e => e.name).join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="tt-row tt-total">
        <span>Total paid</span>
        <span className="tt-accent">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}
