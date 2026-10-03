"use client";

import type { ComponentProps } from "react";
import type { Restaurant, RestaurantTable } from "@/lib/types";
import type { useCart } from "@/hooks/useCart";
import type { useCartTotals } from "@/hooks/useCartTotals";
import DetailOverlay from "./DetailOverlay";
import CartScreen from "./CartScreen";

type CartScreenProps = ComponentProps<typeof CartScreen>;

interface CartOverlayProps
  extends Pick<
    CartScreenProps,
    | "photoOf"
    | "suggestions"
    | "onPickSuggestion"
    | "orderNote"
    | "onChangeNote"
    | "customerName"
    | "onChangeName"
    | "loading"
    | "orderAtRegister"
    | "onEditItem"
    | "onCheckout"
  > {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  cart: ReturnType<typeof useCart>;
  totals: ReturnType<typeof useCartTotals>;
  /** Back to the menu: closing the cart and "add more" go to the same place. */
  onClose: () => void;
}

/**
 * The cart, layered over the menu rather than replacing it — the same
 * treatment the dish detail already gets. On a phone the overlay is opaque
 * and full-bleed, so nothing changes; on a wide screen a checkout form
 * stretched across an empty page was both harder to read and a longer trip
 * back to the food.
 */
export default function CartOverlay({
  restaurant,
  table,
  cart,
  totals,
  onClose,
  ...rest
}: CartOverlayProps) {
  const { pricing, soldOut, orderableItems, tipPct, tipCustom, coupon, setCoupon } = totals;
  return (
    <DetailOverlay wide onClose={onClose}>
      <CartScreen
        {...rest}
        restaurant={restaurant}
        table={table}
        items={cart.items}
        soldOut={soldOut}
        subtotal={pricing.subtotal}
        grossSubtotal={pricing.grossSubtotal}
        discount={pricing.discount}
        serviceFee={pricing.serviceFee}
        tip={pricing.tip}
        tipPct={tipPct}
        tipCustom={tipCustom}
        total={pricing.total}
        coupon={coupon}
        onApplyCoupon={setCoupon}
        onRemoveCoupon={() => setCoupon(null)}
        hints={pricing.hints}
        promoSavings={pricing.promoSavings}
        canCheckout={
          orderableItems.length > 0 && restaurant.accepting_orders && !rest.orderAtRegister
        }
        onChangeTip={totals.choosePct}
        onCustomTip={totals.setTipCustom}
        onRemoveItem={cart.removeItem}
        onChangeQty={cart.setQty}
        onAddMore={onClose}
        // One switch for both: at a table the bill stays open, on the
        // general QR the till holds the order. The cart has the table, so
        // it is the one that turns this into the right offer.
        deferredAllowed={Boolean(restaurant.allow_pay_later)}
        cardsEnabled={Boolean(restaurant.cards_enabled)}
      />
    </DetailOverlay>
  );
}
