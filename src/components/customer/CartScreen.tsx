"use client";

import type { Restaurant, RestaurantTable } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import { useT } from "@/lib/i18n/context";
import CartLineRow from "./CartLineRow";
import OrderTotals from "./OrderTotals";
import TipPicker from "./TipPicker";

interface CartScreenProps {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  items: CartItem[];
  /** Product ids that sold out — shown greyed and excluded from the total. */
  soldOut: Set<string>;
  subtotal: number;
  serviceFee: number;
  tip: number;
  tipPct: number;
  tipCustom: number | null;
  total: number;
  orderNote: string;
  loading: boolean;
  /** False when nothing orderable remains (empty or all sold out). */
  canCheckout: boolean;
  onChangeNote: (note: string) => void;
  onChangeTip: (pct: number) => void;
  onCustomTip: (amount: number | null) => void;
  onRemoveItem: (cartId: number) => void;
  onEditItem: (item: CartItem) => void;
  onAddMore: () => void;
  onCheckout: () => void;
}

/** The review-and-pay screen: line items, kitchen note, totals, checkout button. */
export default function CartScreen({
  restaurant,
  table,
  items,
  soldOut,
  subtotal,
  serviceFee,
  tip,
  tipPct,
  tipCustom,
  total,
  orderNote,
  loading,
  canCheckout,
  onChangeNote,
  onChangeTip,
  onCustomTip,
  onRemoveItem,
  onEditItem,
  onAddMore,
  onCheckout,
}: CartScreenProps) {
  const t = useT();
  // 0 when the fee is switched off, so the totals card doesn't render an empty
  // "Service (10%) — $0.00" row for a fee nobody is being charged.
  const effectiveServicePct = restaurant.service_enabled ? restaurant.service_pct : 0;
  return (
    <div className="tt-root">
      <div className="tt-header">
        <button className="tt-back-inline" onClick={onAddMore}>
          ←
        </button>
        <h2 className="tt-serif" style={{ margin: 0, fontSize: 20 }}>
          {t("cart.title")}
        </h2>
        {table && (
          <span className="tt-badge">{t("menu.table", { label: table.label })}</span>
        )}
      </div>
      <div style={{ padding: 16 }}>
        {items.length === 0 && <p className="tt-muted">{t("cart.empty")}</p>}
        {items.map(item => (
          <CartLineRow
            key={item.cartId}
            item={item}
            currency={restaurant.currency}
            soldOut={soldOut.has(item.itemId)}
            onRemove={onRemoveItem}
            onEdit={onEditItem}
          />
        ))}

        <button className="tt-add-more" onClick={onAddMore}>
          {t("cart.addMore")}
        </button>

        <div style={{ marginBottom: 20 }}>
          <div className="tt-mod-label">{t("cart.kitchenNote")}</div>
          <textarea
            className="tt-input"
            rows={2}
            placeholder={t("cart.kitchenNotePlaceholder")}
            value={orderNote}
            onChange={e => onChangeNote(e.target.value)}
          />
        </div>

        <TipPicker
          currency={restaurant.currency}
          tipPct={tipPct}
          tipCustom={tipCustom}
          onPresetTip={onChangeTip}
          onCustomTip={onCustomTip}
        />

        <OrderTotals
          subtotal={subtotal}
          serviceFee={serviceFee}
          tip={tip}
          tipPct={tipCustom !== null ? 0 : tipPct}
          total={total}
          servicePct={effectiveServicePct}
          taxPct={restaurant.tax_pct}
          taxBreakdown={restaurant.tax_show_breakdown}
          currency={restaurant.currency}
        />

        <button
          className="tt-btn tt-btn-primary tt-btn-lg"
          style={{ width: "100%", marginTop: 20 }}
          disabled={!canCheckout || loading}
          onClick={onCheckout}
        >
          {t(loading ? "cart.redirecting" : "cart.proceed")}
        </button>
        <p
          className="tt-muted"
          style={{ textAlign: "center", fontSize: 12, marginTop: 12 }}
        >
          {t("cart.securedBy")}
        </p>
      </div>
    </div>
  );
}
