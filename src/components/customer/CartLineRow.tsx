"use client";

import { formatMoney } from "@/lib/format";
import { lineUnitPrice } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import { useT } from "@/lib/i18n/context";
import { EditIcon } from "@/components/ui/icons";

interface CartLineRowProps {
  item: CartItem;
  currency: string;
  /** Sold out at checkout: greyed, price struck through, not counted. */
  soldOut?: boolean;
  onRemove: (cartId: number) => void;
  /** Re-opens the item screen prefilled to change extras/notes/quantity. */
  onEdit?: (item: CartItem) => void;
  /**
   * What a quantity deal takes off this product, if one applied. Shown on the
   * line so the offer is visible where the price is — moving only the order
   * total reads as the deal not having worked.
   */
  promoSaving?: { saved: number; promoName: string };
}

/** A single line in the cart, with its modifiers, notes, edit and remove. */
export default function CartLineRow({
  item,
  currency,
  soldOut = false,
  onRemove,
  onEdit,
  promoSaving,
}: CartLineRowProps) {
  const t = useT();
  const gross = lineUnitPrice(item) * item.qty;
  // The deal's saving is spread across every line of that product, so a line
  // shows what it actually costs after the offer.
  const dealPrice = promoSaving
    ? Math.round((gross - promoSaving.saved) * 100) / 100
    : null;
  return (
    <div
      className={`tt-card ${soldOut ? "tt-cart-soldout" : ""}`}
      style={{ padding: 14 }}
    >
      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ fontSize: 28 }}>{item.emoji || "🍽️"}</span>
        <div style={{ flex: 1 }}>
          <div className="tt-row">
            <strong>
              {item.qty}× {item.name}
              {soldOut && (
                <span className="tt-badge" style={{ marginLeft: 8 }}>
                  {t("cart.soldOut")}
                </span>
              )}
            </strong>
            <strong
              className={soldOut ? "tt-muted" : "tt-accent"}
              style={soldOut ? { textDecoration: "line-through" } : undefined}
            >
              {dealPrice !== null && !soldOut && (
                <s className="tt-was">{formatMoney(gross, currency)}</s>
              )}
              {formatMoney(dealPrice !== null && !soldOut ? dealPrice : gross, currency)}
            </strong>
          </div>
          {promoSaving && !soldOut && (
            <div className="tt-tag-row">
              <span className="tt-deal">{promoSaving.promoName}</span>
              <span className="tt-save" style={{ fontSize: 12, fontWeight: 700 }}>
                −{formatMoney(promoSaving.saved, currency)}
              </span>
            </div>
          )}
          {Object.entries(item.mods).map(([k, v]) => (
            <div key={k} className="tt-muted" style={{ fontSize: 12 }}>
              {k}: {Array.isArray(v) ? v.join(", ") : v}
            </div>
          ))}
          {item.extras && item.extras.length > 0 && (
            <div className="tt-muted" style={{ fontSize: 12 }}>
              + {item.extras.map(e => e.name).join(", ")}
            </div>
          )}
          {item.notes && (
            <div className="tt-muted" style={{ fontSize: 12, fontStyle: "italic" }}>
              &ldquo;{item.notes}&rdquo;
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            alignItems: "center",
          }}
        >
          <button className="tt-x" onClick={() => onRemove(item.cartId)}>
            ×
          </button>
          {onEdit && !soldOut && (
            <button
              className="tt-iconbtn"
              style={{ fontSize: 14 }}
              title={t("cart.editItem")}
              aria-label={`${t("cart.editItem")} — ${item.name}`}
              onClick={() => onEdit(item)}
            >
              <EditIcon size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
