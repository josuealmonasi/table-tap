"use client";

import type { Restaurant, RestaurantTable } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import CartLineRow from "./CartLineRow";
import OrderTotals from "./OrderTotals";

/** The review-and-pay screen: line items, kitchen note, totals, checkout button. */
export default function CartScreen({
  restaurant,
  table,
  items,
  subtotal,
  serviceFee,
  total,
  orderNote,
  loading,
  onChangeNote,
  onRemoveItem,
  onAddMore,
  onCheckout,
}: {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  items: CartItem[];
  subtotal: number;
  serviceFee: number;
  total: number;
  orderNote: string;
  loading: boolean;
  onChangeNote: (note: string) => void;
  onRemoveItem: (cartId: number) => void;
  onAddMore: () => void;
  onCheckout: () => void;
}) {
  return (
    <div className="tt-root">
      <div className="tt-header">
        <button className="tt-back-inline" onClick={onAddMore}>←</button>
        <h2 className="tt-serif" style={{ margin: 0, fontSize: 20 }}>Your Order</h2>
        {table && <span className="tt-badge">Table {table.label}</span>}
      </div>
      <div style={{ padding: 16 }}>
        {items.length === 0 && <p className="tt-muted">Your cart is empty.</p>}
        {items.map((item) => (
          <CartLineRow
            key={item.cartId}
            item={item}
            currency={restaurant.currency}
            onRemove={onRemoveItem}
          />
        ))}

        <button className="tt-add-more" onClick={onAddMore}>+ Add more items</button>

        <div style={{ marginBottom: 20 }}>
          <div className="tt-mod-label">Note for the kitchen</div>
          <textarea
            className="tt-input"
            rows={2}
            placeholder="Any notes for the whole order?"
            value={orderNote}
            onChange={(e) => onChangeNote(e.target.value)}
          />
        </div>

        <OrderTotals
          subtotal={subtotal}
          serviceFee={serviceFee}
          total={total}
          servicePct={restaurant.service_pct}
          currency={restaurant.currency}
        />

        <button
          className="tt-btn tt-btn-primary tt-btn-lg"
          style={{ width: "100%", marginTop: 20 }}
          disabled={items.length === 0 || loading}
          onClick={onCheckout}
        >
          {loading ? "Redirecting to payment…" : "Proceed to Payment"}
        </button>
        <p className="tt-muted" style={{ textAlign: "center", fontSize: 12, marginTop: 12 }}>
          🔒 Secured by Stripe · card, Apple Pay &amp; Google Pay
        </p>
      </div>
    </div>
  );
}
