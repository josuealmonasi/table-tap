"use client";

import type { Restaurant, RestaurantTable } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import type { MenuItem } from "@/lib/types";
import type { AppliedCoupon, ItemPromoSaving, PromoHint } from "@/lib/pricing";
import { formatMoney } from "@/lib/format";
import { canOrder, paymentHintKey, paymentOptions } from "@/lib/payment-options";
import { useT } from "@/lib/i18n/context";
import NoteField from "./NoteField";
import CartLineRow from "./CartLineRow";
import CouponBox from "./CouponBox";
import SuggestionStrip from "./SuggestionStrip";
import OrderTotals from "./OrderTotals";
import TipPicker from "./TipPicker";
import { BackIcon, BillIcon, HintIcon, SecureIcon } from "@/components/ui/icons";

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
  onChangeNote: (note: string) => void;
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
  /** Dine-in at a table, where the owner allows settling at the end. */
  payLaterAllowed?: boolean;
  /** General QR, where the owner allows going to the till to pay. */
  counterAllowed?: boolean;
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
  onChangeNote,
  onChangeTip,
  onCustomTip,
  onRemoveItem,
  onChangeQty,
  onEditItem,
  onAddMore,
  suggestions = [],
  onPickSuggestion,
  onCheckout,
  payLaterAllowed = false,
  counterAllowed = false,
  cardsEnabled = true,
}: CartScreenProps) {
  const t = useT();
  // 0 when the fee is switched off, so the totals card doesn't render an empty
  // "Service (10%) — $0.00" row for a fee nobody is being charged.
  const effectiveServicePct = restaurant.service_enabled ? restaurant.service_pct : 0;

  // The three flags arrive already resolved for this screen — table or general
  // QR — so here they are only gathered. `atTable` is true because the one who
  // decides whether "pay at the end" applies is OrderingApp, which knows.
  const pay = paymentOptions({
    cardsEnabled,
    allowPayLater: payLaterAllowed,
    allowCounterPayment: counterAllowed,
    atTable: true,
  });
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
                soldOut={soldOut.has(item.itemId)}
                onRemove={onRemoveItem}
                onChangeQty={onChangeQty}
                onEdit={onEditItem}
              />
            ))}

            <button className="tt-add-more" onClick={onAddMore}>
              {t("cart.addMore")}
            </button>

            <div style={{ marginBottom: 20 }}>
              <NoteField
                label={t("cart.kitchenNote")}
                placeholder={t("cart.kitchenNotePlaceholder")}
                value={orderNote}
                onChange={onChangeNote}
              />
            </div>

            <TipPicker
              currency={restaurant.currency}
              tipPct={tipPct}
              tipCustom={tipCustom}
              maxTip={subtotal}
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
                      // The hint carried the dish and the deal all along; the
                      // copy just never used them, so it read as "add 2 more"
                      // of nothing in particular.
                      name: items.find(i => i.itemId === h.itemId)?.name ?? "",
                      promo: h.promoName,
                      amount: formatMoney(h.save, restaurant.currency),
                    })}
                  </p>
                ))}
              </div>
            )}

            {onPickSuggestion && suggestions.length > 0 && (
              <SuggestionStrip
                items={suggestions}
                currency={restaurant.currency}
                onPick={onPickSuggestion}
              />
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

            {/* Pinned to the foot of the scroll area. A cart with long
                special requests pushes this well past the fold, and the one
                control the diner came here for must never need finding — the
                same rule the dish detail already follows. */}
            <div className="tt-cart-actions">
              {/* At a table that settles later this places the order; the
                  bill it opens is where paying happens, and it is the same
                  bill whether they pay now or after dessert. Everywhere else
                  the card is taken here, because there is no table to settle
                  against. */}
              {/* Sin cuenta de Stripe conectada no hay pago con tarjeta, y
                  ofrecerlo como acción principal sólo lleva a un 409 después
                  de tocarlo. Cuando hay otra forma de pagar, ésa manda. */}
              {pay.payNow && (
                <button
                  className="tt-btn tt-btn-primary tt-btn-lg"
                  style={{ width: "100%" }}
                  disabled={!canCheckout || loading}
                  onClick={() => onCheckout(false)}
                >
                  {t(loading ? "cart.redirecting" : "cart.proceed")}
                </button>
              )}
              {/* Where the table settles at the end, that is the diner's
                  choice to make and not something they should have to find:
                  paying now stays the offer on top, and leaving the bill open
                  is the plain second option under it. Before this the setting
                  decided for them, so a table that allowed settling later gave
                  the diner no way to pay at all. */}
              {(pay.payLater || pay.payCounter) && (
                <button
                  className={`tt-btn tt-btn-lg ${pay.payNow ? "tt-btn-outline" : "tt-btn-primary"}`}
                  style={{ width: "100%", marginTop: pay.payNow ? 10 : 0 }}
                  disabled={!canCheckout || loading}
                  onClick={() => onCheckout(true)}
                >
                  {/* The busy label has to match the button that was pressed:
                      announcing a redirect to payment when the tap only sends
                      food to the kitchen says a card is about to be charged,
                      which is untrue and alarming at a table paying later. */}
                  {t(
                    loading
                      ? "cart.placingOrder"
                      : pay.payLater
                        ? "cart.orderPayLater"
                        : "cart.orderCounter",
                  )}
                </button>
              )}
              {/* And the small print underneath answers the question the
                  button raises: how am I paying? Stripe's name reassures the
                  diner who is about to hand over a card, and says nothing to
                  the one whose bill stays open on the table. */}
              <p
                className="tt-muted"
                style={{ textAlign: "center", fontSize: 12, marginTop: 12 }}
              >
                {/* Lo que dice aquí abajo nombra SÓLO los botones que están
                    arriba. Antes se decidía por `payLaterAllowed` a secas, así
                    que una mesa sin Stripe conectado leía "Paga ahora con
                    tarjeta, o deja la cuenta abierta" debajo de una pantalla
                    donde lo de la tarjeta no existía. */}
                {(() => {
                  const key = paymentHintKey(pay);
                  if (!canOrder(pay)) return t(key);
                  const Icon = pay.payNow && !pay.payLater && !pay.payCounter ? SecureIcon : BillIcon;
                  return (
                    <>
                      <Icon size={12} weight="bold" style={{ verticalAlign: "-1px" }} />{" "}
                      {t(key)}
                    </>
                  );
                })()}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
