"use client";

import { useRef, useState } from "react";
import { useRetryIntent } from "@/hooks/useRetryIntent";
import type { RestaurantTable } from "@/lib/types";
import type { AppliedCoupon } from "@/lib/pricing";
import type { CartItem, useCart } from "@/hooks/useCart";
import type { PendingOrderDetails } from "@/components/ui/PendingOrder";
import { useT } from "@/lib/i18n/context";
import { rememberUsual } from "@/lib/usual";
import { rememberMyOrder } from "@/lib/my-orders";
import { clearUpsell } from "@/lib/upsell";
import { rememberRecentOrder } from "@/lib/recent-order";
import { rememberDinerName } from "@/lib/diner-name";
import { rememberSitting } from "@/lib/table-binding";
import { dinerToken } from "@/lib/diner-token";

export interface PendingCheckout extends PendingOrderDetails { tableId: string | null }

export interface CheckoutInput {
  restaurantId: string;
  table: RestaurantTable | null;
  /** Only the still-orderable lines: sold-out ones stay greyed in the cart. */
  orderableItems: CartItem[];
  orderNote: string;
  customerName: string;
  tipPct: number;
  tipCustom: number | null;
  coupon: AppliedCoupon | null;
  cart: ReturnType<typeof useCart>;
  /** The coupon stopped being usable between applying it and paying. */
  dropCoupon: () => void;
  markSoldOut: (itemId: string) => void;
  notify: (message: string) => void;
  /** A pay-later order is with the kitchen: back to the menu, the bill reloaded. */
  onPlaced: (orderId: string, sessionId: string | null) => void;
}

/**
 * Placing the order: straight to the kitchen when it is paid at the end, or
 * to Stripe Checkout when it is paid now — and every way the server can say
 * "not like that", answered in the cart rather than with a dead end.
 */
export function useCheckout(input: CheckoutInput): {
  checkout: (payLater?: boolean) => Promise<void>;
  discard: () => void;
  loading: boolean;
  frozen: PendingCheckout | null;
} {
  const t = useT();
  const attempt = useRetryIntent();
  const inFlight = useRef(false);
  const sentLines = useRef<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { restaurantId, table, orderableItems, cart } = input;

  async function checkout(payLater = false): Promise<void> {
    if (inFlight.current) return;
    payLater ||= attempt.pending();
    if (orderableItems.length === 0 && !attempt.pending()) {
      input.notify(t("notice.allSoldOut"));
      return;
    }
    if (payLater && !attempt.pending()) sentLines.current = structuredClone(orderableItems);
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: (payLater ? attempt.body : JSON.stringify)({
          restaurantId,
          tableId: table?.id ?? null,
          tableLabel: table?.label ?? null,
          // The list is explicit on purpose — the server must not receive `cartId` or
          // anything from the view — but it was missing the two things that make a
          // combo a combo. Without `comboId` the server saw a loose line whose
          // `itemId` is a promotion id, looked for it among the dishes, did not find
          // it and answered "no longer available": combos could not be ordered
          // at all, and they are a paid-plan feature.
          items: orderableItems.map(c => ({
            itemId: c.itemId,
            name: c.name,
            emoji: c.emoji,
            price: c.price,
            qty: c.qty,
            mods: c.mods,
            extras: c.extras,
            notes: c.notes,
            ...(c.comboId ? { comboId: c.comboId, components: c.components } : {}),
          })),
          note: input.orderNote || undefined,
          customerName: input.customerName || undefined,
          tipPct: input.tipPct,
          tipAmount: input.tipCustom ?? undefined,
          couponCode: input.coupon?.code,
          payLater,
          // A counter hint only. Table orders use the server-issued cookie
          // and the approved member id, because a self-chosen id cannot
          // prove who owns a split seat or permission to join this party.
          diner: dinerToken(restaurantId) || undefined,
        }),
      });
      const data = await res.json();
      const frozen = payLater ? attempt.frozen<PendingCheckout>() : null;
      if (payLater && ((res.ok && data.deferred && data.orderId) || (!res.ok && attempt.settles(res.status, data)))) attempt.clear();
      // Deferred: the food is already with the kitchen, so there is no Stripe
      // hop. Remember the id — it is the only thing that tells this phone's
      // share apart from the rest of the table's on the bill.
      if (data.deferred && data.orderId) {
        // Both lists: one decides whose share is whose on the bill, the other
        // drives the "track your order" link and the rating prompt. A dine-in
        // order used to reach only the first.
        rememberMyOrder(restaurantId, data.orderId);
        rememberRecentOrder(restaurantId, data.orderId, frozen?.tableId ?? table?.id);
        rememberUsual(restaurantId, frozen?.items ?? orderableItems);
        const name = frozen?.customerName ?? input.customerName;
        if (name.trim()) rememberDinerName(restaurantId, name);
        // This phone is now sitting at this table, and stays bound to it until
        // the bill is cleared.
        const sitting = data.sessionId && table?.id ? (data.sessionId as string) : null;
        if (sitting && table?.id) rememberSitting(restaurantId, sitting, table.id);
        clearUpsell(restaurantId);
        cart.removeOrdered(sentLines.current);
        input.onPlaced(data.orderId, sitting);
        setLoading(false);
        return;
      }
      if (data.url) {
        // Counted as ordered once the order exists; a checkout abandoned at
        // Stripe still said what this diner likes, and all it changes is
        // which dishes the menu suggests.
        rememberUsual(restaurantId, orderableItems);
        window.location.href = data.url; // Stripe Checkout
        return;
      }
      // The coupon stopped being usable between applying it and paying (most
      // likely someone else took the last use). Drop it and let them retry.
      if (data.couponReason) {
        input.dropCoupon();
        input.notify(t(`coupon.${data.couponReason}`));
        setLoading(false);
        return;
      }
      // One or more extras sold out: drop them from the cart, tell the customer,
      // and let them pay again for the adjusted order.
      if (data.removedExtraIds) {
        cart.removeExtras(data.removedExtraIds);
        const names: string[] = data.removedExtraNames ?? [];
        input.notify(t("cart.extrasRemoved", { names: names.join(", ") }));
        setLoading(false);
        return;
      }
      // The kitchen has some, but not as many as they asked for. Cut the cart
      // to what is really there and say so, rather than making them find the
      // line and count it down themselves.
      if (data.shortStock) {
        cart.trimToStock(data.shortStock);
        input.notify(`${data.error} ${t("cart.stockTrimmed")}`);
        setLoading(false);
        return;
      }
      // An item sold out between loading the menu and checking out: mark it
      // sold out (it greys out and drops from the total) so the rest can pay.
      if (data.unavailableItemId) {
        input.markSoldOut(data.unavailableItemId);
        input.notify(`${data.error} ${t("notice.markedSoldOut")}`);
      } else if (!(payLater && attempt.pending() && res.status >= 500)) {
        // A refusal says something the retry screen does not, so it shows;
        // a server error on a kept order is what that screen already says.
        input.notify(data.error ?? t("notice.generic"));
      }
      setLoading(false);
    } catch {
      // An order kept for a retry has its own screen saying what happened and
      // what to do. A modal over it, «Atención: Error de red» or «No pudimos
      // crear tu pedido», read as an order that had failed while the screen
      // said it may already be with the kitchen.
      if (!(payLater && attempt.pending())) input.notify(t("notice.network"));
      setLoading(false);
    } finally {
      inFlight.current = false;
    }
  }

  return { checkout, discard: () => { if (!inFlight.current) attempt.clear(); }, loading, frozen: attempt.unconfirmed(loading) ? attempt.frozen<PendingCheckout>() : null };
}
