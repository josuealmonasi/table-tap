import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";

/** A single tappable row in the menu list. */
export default function MenuItemRow({
  item,
  currency,
  onSelect,
}: {
  item: MenuItem;
  currency: string;
  onSelect: (item: MenuItem) => void;
}) {
  return (
    <div className="tt-card tt-item" onClick={() => onSelect(item)}>
      <div className="tt-thumb">{item.emoji || "🍽️"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>{item.name}</strong>
          {item.popular && <span className="tt-pop">Popular</span>}
        </div>
        <div className="tt-desc tt-muted">{item.description}</div>
        <div className="tt-accent" style={{ fontWeight: 700, fontSize: 16 }}>
          {formatMoney(item.price, currency)}
        </div>
      </div>
      <div className="tt-plus">+</div>
    </div>
  );
}
