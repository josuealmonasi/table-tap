import { formatMoney } from "@/lib/format";
import type { OrderLineItem } from "@/lib/types";

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
          <div key={i} className="tt-row" style={{ fontSize: 14, marginBottom: 8 }}>
            <span>{item.qty}× {item.emoji} {item.name}</span>
            <span className="tt-muted">{formatMoney(item.price * item.qty, currency)}</span>
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
