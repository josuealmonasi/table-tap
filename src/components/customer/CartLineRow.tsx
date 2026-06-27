import { formatMoney } from "@/lib/format";
import type { CartItem } from "@/hooks/useCart";

/** A single line in the cart, with its modifiers, notes, and a remove button. */
export default function CartLineRow({
  item,
  currency,
  onRemove,
}: {
  item: CartItem;
  currency: string;
  onRemove: (cartId: number) => void;
}) {
  return (
    <div className="tt-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ fontSize: 28 }}>{item.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="tt-row">
            <strong>{item.qty}× {item.name}</strong>
            <strong className="tt-accent">{formatMoney(item.price * item.qty, currency)}</strong>
          </div>
          {Object.entries(item.mods).map(([k, v]) => (
            <div key={k} className="tt-muted" style={{ fontSize: 12 }}>
              {k}: {Array.isArray(v) ? v.join(", ") : v}
            </div>
          ))}
          {item.notes && (
            <div className="tt-muted" style={{ fontSize: 12, fontStyle: "italic" }}>
              &ldquo;{item.notes}&rdquo;
            </div>
          )}
        </div>
        <button className="tt-x" onClick={() => onRemove(item.cartId)}>×</button>
      </div>
    </div>
  );
}
