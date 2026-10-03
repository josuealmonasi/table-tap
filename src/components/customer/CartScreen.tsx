"use client";

import type { Restaurant, RestaurantTable } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import type { MenuItem } from "@/lib/types";
import type { AppliedCoupon, ItemPromoSaving, PromoHint } from "@/lib/pricing";
import { paymentOptions } from "@/lib/payment-options";
import { useT } from "@/lib/i18n/context";
import NoteField from "./NoteField";
import { NAME_MAX } from "@/lib/notes";
import CartLineRow from "./CartLineRow";
import CouponBox from "./CouponBox";
import SuggestionStrip from "./SuggestionStrip";
import OrderTotals from "./OrderTotals";
import TipPicker from "./TipPicker";
import { BackIcon } from "@/components/ui/icons";
import CartCheckoutActions from "./CartCheckoutActions";

interface CartScreenProps {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  items: CartItem[];
  /** The dish's photo, looked up from the live menu — null falls back to emoji. */
  photoOf: (itemId: string) => string | null;
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
  /** product id → what a deal took off it, for the struck-through line price. */
  promoSavings: Record<string, ItemPromoSaving>;
  orderNote: string;
  loading: boolean;
  /** False when nothing orderable remains (empty or all sold out). */
  canCheckout: boolean;
  /**
   * Caja: the order is taken at the register. The cart is a list to show the
   * cashier, and offers no button that would be refused.
   */
  orderAtRegister?: boolean;
  onChangeNote: (note: string) => void;
  /** Counter orders only — the name the cashier calls out. */
  customerName?: string;
  onChangeName?: (name: string) => void;
  onChangeTip: (pct: number) => void;
  onCustomTip: (amount: number | null) => void;
  onRemoveItem: (cartId: number) => void;
  onChangeQty: (cartId: number, qty: number) => void;
  onEditItem: (item: CartItem) => void;
  onAddMore: () => void;
  /** "Anything else?" — empty once the diner has taken one on this bill. */
  suggestions?: MenuItem[];
  onPickSuggestion?: (item: MenuItem) => void;
  onCheckout: (payLater?: boolean) => void;
  /**
   * The owner's "pay at the end / at the counter" switch. Which of the two it
   * turns out to be is decided here, from `table` — the same switch means
   * "settle at the end" at a table and "collect at the till" on the general QR.
   */
  deferredAllowed?: boolean;
  /** Whether the restaurant can take cards right now. */
  cardsEnabled?: boolean;
}

/** The review-and-pay screen: line items, kitchen note, totals, checkout button. */
export default function CartScreen({
  restaurant,
  table,
  items,
  photoOf,
  soldOut,
  grossSubtotal,
  discount,
  coupon,
  onApplyCoupon,
  onRemoveCoupon,
  hints,
  promoSavings,
  subtotal,
  serviceFee,
  tip,
  tipPct,
  tipCustom,
  total,
  orderNote,
  loading,
  canCheckout,
  orderAtRegister = false,
  onChangeNote,
  customerName = "",
  onChangeName,
  onChangeTip,
  onCustomTip,
  onRemoveItem,
  onChangeQty,
  onEditItem,
  onAddMore,
  suggestions = [],
  onPickSuggestion,
  onCheckout,
  deferredAllowed = false,
  cardsEnabled = true,
}: CartScreenProps) {
  const t = useT();
  // 0 when the fee is switched off, so the totals card doesn't render an empty
  // "Service (10%) — $0.00" row for a fee nobody is being charged.
  const effectiveServicePct = restaurant.service_enabled ? restaurant.service_pct : 0;

  // Which QR the diner came in through is what turns one switch into two
  // offers, and this screen is the only place that knows: it holds the table.
  // `atTable` used to be hardcoded true here, which made `payCounter` — defined
  // as "no table is holding this" — impossible to reach. A restaurant with the
  // switch on showed the general QR a cart saying it could not take cards, and
  // no button at all.
  const pay = paymentOptions({
    cardsEnabled,
    allowDeferred: deferredAllowed,
    atTable: Boolean(table),
    acceptingOrders: restaurant.accepting_orders,
  });

  // A quantity deal belongs to the product, not to one line of it: the engine
  // counts every line of a product together, so the nudge it produces is about
  // all of them. Painting it on each line would tell a diner with two lines of
  // the same dish to add one more, twice. The first line of that product
  // carries it.
  const nudgeByItem = new Map(hints.map(h => [h.itemId, h]));
  const nudgeLine = new Map<string, number>();
  for (const item of items) {
    if (!nudgeLine.has(item.itemId)) nudgeLine.set(item.itemId, item.cartId);
  }
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
                imageUrl={photoOf(item.itemId)}
                currency={restaurant.currency}
                promoSaving={promoSavings[item.itemId]}
                promoHint={
                  nudgeLine.get(item.itemId) === item.cartId
                    ? nudgeByItem.get(item.itemId)
                    : undefined
                }
                soldOut={soldOut.has(item.itemId)}
                onRemove={onRemoveItem}
                onChangeQty={onChangeQty}
                onEdit={onEditItem}
              />
            ))}

            <button className="tt-add-more" onClick={onAddMore}>
              {t("cart.addMore")}
            </button>

            {/* Not on Caja: the list is shown at the register, so a name, a note
                for the kitchen, a tip or a coupon typed here would reach nobody —
                the cashier takes all four at the till. */}
            {!orderAtRegister && (
            <div style={{ marginBottom: 20 }}>
              {/* Only without a table: at a table, the table IS the name, and
                  asking anyway would be collecting a name for nothing. The
                  pickup code still identifies the order — this is what gets
                  called across the room. */}
              {!table && (
                <label className="tt-field" style={{ marginBottom: 12 }}>
                  <span className="tt-mod-label">{t("cart.yourName")}</span>
                  <input
                    className="tt-input"
                    value={customerName}
                    maxLength={NAME_MAX}
                    placeholder={t("cart.yourNamePlaceholder")}
                    aria-label={t("cart.yourName")}
                    onChange={e => onChangeName?.(e.target.value)}
                  />
                </label>
              )}

              <NoteField
                label={t("cart.kitchenNote")}
                placeholder={t("cart.kitchenNotePlaceholder")}
                value={orderNote}
                onChange={onChangeNote}
              />
            </div>
            )}

            {!orderAtRegister && (
            <TipPicker
              currency={restaurant.currency}
              tipPct={tipPct}
              tipCustom={tipCustom}
              maxTip={subtotal}
              onPresetTip={onChangeTip}
              onCustomTip={onCustomTip}
            />
            )}

            {/* The nudges used to be a block of their own down here, below the
                tip picker and named after dishes the diner had to scroll back
                up to find. They belong on the line they are about: that is
                where the "+" is, and where a dish under an unearned deal was
                indistinguishable from a dish with no deal at all. */}
            {onPickSuggestion && suggestions.length > 0 && (
              <SuggestionStrip
                items={suggestions}
                currency={restaurant.currency}
                onPick={onPickSuggestion}
              />
            )}

            {!orderAtRegister && restaurant.coupons_enabled && (
            <div className="tt-coupon-row">
              <CouponBox
                restaurantId={restaurant.id}
                subtotal={subtotal}
                applied={coupon}
                onApply={onApplyCoupon}
                onRemove={onRemoveCoupon}
              />
            </div>
            )}

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

            <CartCheckoutActions
              pay={pay}
              acceptingOrders={restaurant.accepting_orders}
              orderAtRegister={orderAtRegister}
              canCheckout={canCheckout}
              loading={loading}
              onCheckout={onCheckout}
            />
          </>
        )}
      </div>
    </div>
  );
}
