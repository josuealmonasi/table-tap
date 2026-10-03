import { capName, capNote } from "@/lib/notes";
import type { PricedCart } from "@/lib/pricing";
import type { OrderLineItem } from "@/lib/types";

interface CheckoutOrderInput {
  restaurantId: string;
  tableId: string | null;
  tableLabel: string | null;
  sessionId: string | null;
  /** The throwaway id the phone gave itself, exactly as the client sent it. */
  diner: unknown;
  deferred: boolean;
  pricing: PricedCart;
  taxPct: number;
  /** What we take from this order, in cents. */
  appFeeCents: number;
  couponCode: string | null;
  currency: string;
  verified: OrderLineItem[];
  note: string | undefined;
  customerName: string | undefined;
}

/** The `orders` row a diner's checkout writes, before any money moves. */
export function checkoutOrderRow(o: CheckoutOrderInput) {
  const { pricing } = o;
  return {
    restaurant_id: o.restaurantId,
    table_id: o.tableId,
    table_label: o.tableLabel,
    session_id: o.sessionId,
    // Which phone this was. Bounded because it comes from the client and
    // is written with the secret key; anything longer is not one of ours.
    diner: typeof o.diner === "string" && o.diner.length > 0 && o.diner.length <= 64 ? o.diner : null,
    // A deferred order skips the payment gate and goes straight to the
    // pass: the kitchen starts cooking, `paid` stays false, and the table
    // settles at the end. `pending_payment` is what hides an order from the
    // board until Stripe confirms, which is exactly what must not happen
    // here.
    status: o.deferred ? "received" : "pending_payment",
    subtotal: pricing.subtotal,
    service_fee: pricing.serviceFee,
    tip: pricing.tip,
    tax_pct: o.taxPct,
    discount: pricing.discount,
    platform_fee: o.appFeeCents / 100,
    coupon_code: o.couponCode,
    // Where the discount came from, so the owner can tell a menu sale from
    // a quantity deal from a coupon when reviewing an order later.
    promo_detail:
      pricing.discount > 0
        ? {
            item: pricing.itemDiscount,
            promos: pricing.promoDiscount,
            coupon: pricing.couponDiscount,
          }
        : null,
    total: pricing.total,
    currency: o.currency,
    items: o.verified,
    note: capNote(o.note) ?? null,
    // Ignored outright when there is a table. A name is how the counter
    // finds a person; a table already has one, and storing a name nobody
    // asked for would be collecting personal data for nothing.
    customer_name: o.tableId ? null : (capName(o.customerName) ?? null),
    paid: false,
  };
}
