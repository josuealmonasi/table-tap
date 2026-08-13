"use client";

import { formatMoney } from "@/lib/format";
import { lineUnitPrice } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import { useT } from "@/lib/i18n/context";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddIcon, DeleteIcon, EditIcon, RemoveIcon } from "@/components/ui/icons";

interface CartLineRowProps {
  item: CartItem;
  currency: string;
  /** Sold out at checkout: greyed, price struck through, not counted. */
  soldOut?: boolean;
  onRemove: (cartId: number) => void;
  /** Changes how many of this line are ordered. */
  onChangeQty: (cartId: number, qty: number) => void;
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
  onChangeQty,
  onEdit,
  promoSaving,
}: CartLineRowProps) {
  const t = useT();
  const confirm = useConfirm();

  /**
   * Stepping down from one removes the line, so it asks first. Every other
   * step is a single tap with no confirmation — undoing a wrong "+" is one
   * tap on "−", but a removal would cost the customer their extras and notes.
   */
  async function stepDown() {
    if (item.qty > 1 && !soldOut) {
      onChangeQty(item.cartId, item.qty - 1);
      return;
    }
    const ok = await confirm({
      title: t("cart.removeConfirm", { name: item.name }),
      message: t("cart.removeConfirmMsg"),
      confirmLabel: t("common.remove"),
      danger: true,
    });
    if (ok) onRemove(item.cartId);
  }
  const charged = lineUnitPrice(item) * item.qty;
  // What to strike through. For a quantity deal that's the line's own gross —
  // the saving comes off it. A combo is different: it is already sold at the
  // bundle price, so striking that would show a discount off the discount.
  // Strike what the components cost separately instead, which is exactly what
  // the menu card shows.
  const regular = item.comboRegular
    ? Math.round(item.comboRegular * item.qty * 100) / 100
    : charged;
  // The deal's saving is spread across every line of that product, so a line
  // shows what it actually costs after the offer.
  const dealPrice = promoSaving
    ? Math.round((regular - promoSaving.saved) * 100) / 100
    : null;
  return (
    <div
      className={`tt-card ${soldOut ? "tt-cart-soldout" : ""}`}
      style={{ padding: 14 }}
    >
      {/* Centred, so the price and the controls sit on the dish's own line
          instead of stepping down it. */}
      <div className="tt-line">
        <span style={{ fontSize: 28 }}>{item.emoji || "🍽️"}</span>
        <div className="tt-line-body">
          <strong>
            {item.qty}× {item.name}
            {soldOut && (
              <span className="tt-badge" style={{ marginLeft: 8 }}>
                {t("cart.soldOut")}
              </span>
            )}
          </strong>
          {promoSaving && !soldOut && (
            <div className="tt-tag-row">
              <span className="tt-deal">{promoSaving.promoName}</span>
              <span className="tt-save" style={{ fontSize: 12, fontWeight: 700 }}>
                −{formatMoney(promoSaving.saved, currency)}
              </span>
            </div>
          )}
          {Object.entries(item.mods).map(([k, v]) => (
            <div key={k} className="tt-muted tt-subline" style={{ fontSize: 12 }}>
              {k}: {Array.isArray(v) ? v.join(", ") : v}
            </div>
          ))}
          {item.extras && item.extras.length > 0 && (
            <div className="tt-muted tt-subline" style={{ fontSize: 12 }}>
              + {item.extras.map(e => e.name).join(", ")}
            </div>
          )}
          {item.notes && (
            <div className="tt-muted tt-subline" style={{ fontSize: 12, fontStyle: "italic" }}>
              &ldquo;{item.notes}&rdquo;
            </div>
          )}
        </div>
        <div className="tt-line-actions">
          <strong
            className={soldOut ? "tt-muted" : "tt-accent"}
            style={soldOut ? { textDecoration: "line-through" } : undefined}
          >
            {dealPrice !== null && !soldOut && (
              <s className="tt-was">{formatMoney(regular, currency)}</s>
            )}
            {formatMoney(dealPrice !== null && !soldOut ? dealPrice : charged, currency)}
          </strong>
          {onEdit && !soldOut && (
            <button
              className="tt-iconbtn"
              title={t("cart.editItem")}
              aria-label={`${t("cart.editItem")} — ${item.name}`}
              onClick={() => onEdit(item)}
            >
              <EditIcon size={16} />
            </button>
          )}
          {/* Reuses .tt-stepper from the item screen — same control, so it
                should look the same; -sm only tightens it for a cart line.
                A sold-out line can't be ordered at any quantity, so it offers
                removal alone rather than a stepper that changes nothing. */}
          <div className="tt-stepper tt-stepper-sm">
            <button
              className={item.qty > 1 && !soldOut ? undefined : "tt-stepper-del"}
              aria-label={`${item.qty > 1 && !soldOut ? t("cart.decrease") : t("cart.removeItem")} — ${item.name}`}
              onClick={stepDown}
            >
              {item.qty > 1 && !soldOut ? (
                <RemoveIcon size={15} />
              ) : (
                <DeleteIcon size={15} />
              )}
            </button>
            {!soldOut && (
              <>
                <span aria-live="polite">{item.qty}</span>
                <button
                  aria-label={`${t("cart.increase")} — ${item.name}`}
                  onClick={() => onChangeQty(item.cartId, item.qty + 1)}
                >
                  <AddIcon size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
