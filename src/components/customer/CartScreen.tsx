"use client";

import type { Restaurant, RestaurantTable } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import type { AppliedCoupon, PromoHint } from "@/lib/pricing";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import CartLineRow from "./CartLineRow";
import CouponBox from "./CouponBox";
import OrderTotals from "./OrderTotals";
import TipPicker from "./TipPicker";
import { BackIcon, HintIcon, SecureIcon } from "@/components/ui/icons";

interface CartScreenProps {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  items: CartItem[];
  /** Product ids that sold out — shown greyed and excluded from the total. */
  soldOut: Set<string>;
  subtotal: number;
  grossSubtotal: number;
  discount: number;
  serviceFee: number;
  tip: number;
  tipPct: number;
  tipCustom: number | null;
  total: number;
  coupon: AppliedCoupon | null;
  onApplyCoupon: (coupon: AppliedCoupon) => void;
  onRemoveCoupon: () => void;
  /** "Add 1 more and save $2" nudges from the pricing engine. */
  hints: PromoHint[];
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
  grossSubtotal,
  discount,
  coupon,
  onApplyCoupon,
  onRemoveCoupon,
  hints,
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
          <BackIcon size={18} weight="bold" />
        </button>
        <h2 className="tt-serif" style={{ margin: 0, fontSize: 20 }}>
          {t("cart.title")}
        </h2>
        {table && (
          <span className="tt-badge">{t("menu.table", { label: table.label })}</span>
        )}
      </div>
      <div style={{ padding: 16 }}>
        {/* Nothing in the cart means nothing to tip on, discount, or pay for.
            Showing the note field, tip picker, coupon link and a MX$0.00 total
            behind a dead "Ir a pagar" just gives the diner a wall of controls
            that can't do anything. One way out instead. */}
        {items.length === 0 ? (
          <div className="tt-cart-empty">
            <p className="tt-muted" style={{ margin: 0 }}>
              {t("cart.empty")}
            </p>
            <button className="tt-btn tt-btn-primary" onClick={onAddMore}>
              {t("cart.browseMenu")}
            </button>
          </div>
        ) : (
          <>
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

            {hints.length > 0 && (
              <div className="tt-hints">
                {hints.map(h => (
                  <p key={`${h.itemId}-${h.promoName}`} className="tt-hint">
                    <HintIcon size={14} weight="fill" />{" "}
                    {t("promos.addMoreHint", {
                      qty: h.addQty,
                      amount: formatMoney(h.save, restaurant.currency),
                    })}
                  </p>
                ))}
              </div>
            )}

            <div className="tt-coupon-row">
              <CouponBox
                restaurantId={restaurant.id}
                subtotal={subtotal}
                applied={coupon}
                onApply={onApplyCoupon}
                onRemove={onRemoveCoupon}
              />
            </div>

            <OrderTotals
              subtotal={subtotal}
              grossSubtotal={grossSubtotal}
              discount={discount}
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
              <SecureIcon size={12} weight="bold" style={{ verticalAlign: "-1px" }} />{" "}
              {t("cart.securedBy")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
