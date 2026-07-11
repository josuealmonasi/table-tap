import { formatMoney } from "@/lib/format";
import { lineUnitPrice } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";

interface CartLineRowProps {
  item: CartItem;
  currency: string;
  /** Sold out at checkout: greyed, price struck through, not counted. */
  soldOut?: boolean;
  onRemove: (cartId: number) => void;
  /** Re-opens the item screen prefilled to change extras/notes/quantity. */
  onEdit?: (item: CartItem) => void;
}

/** A single line in the cart, with its modifiers, notes, edit and remove. */
export default function CartLineRow({ item, currency, soldOut = false, onRemove, onEdit }: CartLineRowProps) {
  return (
    <div className={`tt-card ${soldOut ? "tt-cart-soldout" : ""}`} style={{ padding: 14 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ fontSize: 28 }}>{item.emoji || "🍽️"}</span>
        <div style={{ flex: 1 }}>
          <div className="tt-row">
            <strong>
              {item.qty}× {item.name}
              {soldOut && <span className="tt-badge" style={{ marginLeft: 8 }}>Sold out</span>}
            </strong>
            <strong className={soldOut ? "tt-muted" : "tt-accent"} style={soldOut ? { textDecoration: "line-through" } : undefined}>
              {formatMoney(lineUnitPrice(item) * item.qty, currency)}
            </strong>
          </div>
          {Object.entries(item.mods).map(([k, v]) => (
            <div key={k} className="tt-muted" style={{ fontSize: 12 }}>
              {k}: {Array.isArray(v) ? v.join(", ") : v}
            </div>
          ))}
          {item.extras && item.extras.length > 0 && (
            <div className="tt-muted" style={{ fontSize: 12 }}>
              + {item.extras.map((e) => e.name).join(", ")}
            </div>
          )}
          {item.notes && (
            <div className="tt-muted" style={{ fontSize: 12, fontStyle: "italic" }}>
              &ldquo;{item.notes}&rdquo;
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          <button className="tt-x" onClick={() => onRemove(item.cartId)}>×</button>
          {onEdit && !soldOut && (
            <button
              className="tt-iconbtn"
              style={{ fontSize: 14 }}
              title="Edit item"
              aria-label={`Edit ${item.name}`}
              onClick={() => onEdit(item)}
            >
              ✏️
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
