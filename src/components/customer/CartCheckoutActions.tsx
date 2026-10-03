"use client";

import { useT } from "@/lib/i18n/context";
import { canOrder, paymentHintKey, type PaymentOptions } from "@/lib/payment-options";
import { BillIcon, SecureIcon } from "@/components/ui/icons";

interface CartCheckoutActionsProps {
  /** Which ways to pay this QR and this restaurant can offer. */
  pay: PaymentOptions;
  acceptingOrders: boolean;
  /** Caja: the order is taken at the register. */
  orderAtRegister: boolean;
  canCheckout: boolean;
  loading: boolean;
  onCheckout: (payLater: boolean) => void;
}

/**
 * The cart's way out: pay now, leave the bill open or pay at the counter, and
 * the line underneath that says how the diner is paying.
 *
 * Pinned to the foot of the scroll area. A cart with long special requests
 * pushes this well past the fold, and the one control the diner came here for
 * must never need finding — the same rule the dish detail already follows.
 */
export default function CartCheckoutActions({
  pay,
  acceptingOrders,
  orderAtRegister,
  canCheckout,
  loading,
  onCheckout,
}: CartCheckoutActionsProps) {
  const t = useT();
  return (
    <div className="tt-cart-actions">
      {orderAtRegister ? (
        <p className="tt-cart-register-note" role="status">
          {t("cart.orderAtRegister")}
        </p>
      ) : (
        <>
          {/* At a table that settles later this places the order; the
          bill it opens is where paying happens, and it is the same
          bill whether they pay now or after dessert. Everywhere else
          the card is taken here, because there is no table to settle
          against. */}
          {/* With no connected Stripe account there is no card payment, and
          offering it as the main action only leads to a 409 after they
          tap it. Where another way to pay exists, that one leads. */}
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
            {/* What this line says names ONLY the buttons above it. It used to
            be chosen from `payLaterAllowed` alone, so a table with no
            Stripe connected read "pay now by card, or leave the bill
            open" underneath a screen where the card half did not
            exist. */}
            {(() => {
              const key = paymentHintKey(pay, acceptingOrders);
              if (!canOrder(pay)) return t(key);
              const Icon =
                pay.payNow && !pay.payLater && !pay.payCounter ? SecureIcon : BillIcon;
              return (
                <>
                  <Icon size={12} weight="bold" style={{ verticalAlign: "-1px" }} />{" "}
                  {t(key)}
                </>
              );
            })()}
          </p>
        </>
      )}
    </div>
  );
}
