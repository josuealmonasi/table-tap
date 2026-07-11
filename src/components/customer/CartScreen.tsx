"use client";

import type { Restaurant, RestaurantTable } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
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
  onAddMore,
  onCheckout,
}: CartScreenProps) {
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
            soldOut={soldOut.has(item.itemId)}
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
          servicePct={restaurant.service_pct}
          currency={restaurant.currency}
        />

        <button
          className="tt-btn tt-btn-primary tt-btn-lg"
          style={{ width: "100%", marginTop: 20 }}
          disabled={!canCheckout || loading}
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
