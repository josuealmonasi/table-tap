"use client";

import { useMemo, useState } from "react";
import {
  lineUnitPrice,
  type Category,
  type MenuItem,
  type OrderLineItem,
  type Restaurant,
  type RestaurantTable,
} from "@/lib/types";
import { useCart } from "@/hooks/useCart";
import { Modal } from "@/components/ui/Modal";
import MenuScreen from "./MenuScreen";
import ItemDetailScreen from "./ItemDetailScreen";
import CartScreen from "./CartScreen";

type Screen = "menu" | "item" | "cart";

/**
 * The QR-target customer app. Owns which screen is showing and the cart, and
 * delegates rendering to MenuScreen / ItemDetailScreen / CartScreen.
 */
export default function OrderingApp({
  restaurant,
  table,
  categories,
  items,
  extras,
  extrasByProduct,
}: {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  categories: Category[];
  items: MenuItem[];
  extras: MenuItem[];
  extrasByProduct: Record<string, string[]>;
}) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [orderNote, setOrderNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Product ids that sold out at checkout — kept in the cart but greyed out
  // and excluded from the total and the next payment attempt.
  const [soldOut, setSoldOut] = useState<Set<string>>(new Set());
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const cart = useCart(restaurant);

  // Totals count only the still-orderable lines (sold-out ones are excluded).
  const orderableItems = cart.items.filter((i) => !soldOut.has(i.itemId));
  const subtotal = orderableItems.reduce((sum, i) => sum + lineUnitPrice(i) * i.qty, 0);
  const serviceFee = +(subtotal * (restaurant.service_pct / 100)).toFixed(2);
  // An exact "Other" amount wins over the percentage chips.
  const tip = tipCustom ?? +(subtotal * (tipPct / 100)).toFixed(2);
  const total = +(subtotal + serviceFee + tip).toFixed(2);

  const extrasById = useMemo(() => new Map(extras.map((e) => [e.id, e])), [extras]);

  // The available extra items offered by the currently selected product.
  const selectedExtras = useMemo(() => {
    if (!selected) return [];
    return (extrasByProduct[selected.id] ?? [])
      .map((id) => extrasById.get(id))
      .filter((e): e is MenuItem => Boolean(e));
  }, [selected, extrasByProduct, extrasById]);

  function openItem(item: MenuItem) {
    setSelected(item);
    setScreen("item");
  }

  function addToCart(line: OrderLineItem) {
    cart.addItem(line);
    setScreen("menu");
  }

  async function checkout() {
    // Only pay for the still-orderable lines (any already-sold-out ones stay
    // greyed in the cart for the customer to see).
    if (orderableItems.length === 0) {
      setNotice("Everything in your cart just sold out. Add something else to order.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: restaurant.id,
          tableId: table?.id ?? null,
          tableLabel: table?.label ?? null,
          items: orderableItems.map((c) => ({
            itemId: c.itemId,
            name: c.name,
            emoji: c.emoji,
            price: c.price,
            qty: c.qty,
            mods: c.mods,
            extras: c.extras,
            notes: c.notes,
          })),
          note: orderNote || undefined,
          tipPct,
          tipAmount: tipCustom ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // Stripe Checkout
        return;
      }
      // One or more extras sold out: drop them from the cart, tell the customer,
      // and let them pay again for the adjusted order.
      if (data.removedExtraIds) {
        cart.removeExtras(data.removedExtraIds);
        const names: string[] = data.removedExtraNames ?? [];
        const many = names.length > 1;
        setNotice(
          `${names.join(", ")} ${many ? "are" : "is"} no longer available, so we removed ` +
            `${many ? "them" : "it"} from your order. Review and pay again.`
        );
        setLoading(false);
        return;
      }
      // An item sold out between loading the menu and checking out: mark it
      // sold out (it greys out and drops from the total) so the rest can pay.
      if (data.unavailableItemId) {
        setSoldOut((prev) => new Set(prev).add(data.unavailableItemId));
        setNotice(`${data.error} We've marked it sold out — remove it or pay for the rest of your order.`);
      } else {
        setNotice(data.error ?? "Something went wrong. Please try again.");
      }
      setLoading(false);
    } catch {
      setNotice("Network error — please check your connection and try again.");
      setLoading(false);
    }
  }

  if (screen === "item" && selected) {
    return (
      <ItemDetailScreen
        item={selected}
        extras={selectedExtras}
        currency={restaurant.currency}
        onBack={() => setScreen("menu")}
        onAdd={addToCart}
      />
    );
  }

  if (screen === "cart") {
    return (
      <>
        <CartScreen
          restaurant={restaurant}
          table={table}
          items={cart.items}
          soldOut={soldOut}
          subtotal={subtotal}
          serviceFee={serviceFee}
          tip={tip}
          tipPct={tipPct}
          tipCustom={tipCustom}
          total={total}
          orderNote={orderNote}
          loading={loading}
          canCheckout={orderableItems.length > 0 && restaurant.accepting_orders}
          onChangeNote={setOrderNote}
          onChangeTip={(pct) => {
            setTipPct(pct);
            setTipCustom(null); // picking a preset clears the exact amount
          }}
          onCustomTip={setTipCustom}
          onRemoveItem={cart.removeItem}
          onAddMore={() => setScreen("menu")}
          onCheckout={checkout}
        />
        <Modal open={!!notice} onClose={() => setNotice(null)} maxWidth={400}>
          <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 8 }}>Heads up</h3>
          <p className="tt-muted" style={{ marginTop: 0 }}>{notice}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="tt-btn tt-btn-primary tt-btn-sm" onClick={() => setNotice(null)}>OK</button>
          </div>
        </Modal>
      </>
    );
  }

  return (
    <MenuScreen
      restaurant={restaurant}
      table={table}
      categories={categories}
      items={items}
      cartCount={cart.count}
      cartTotal={cart.total}
      onSelectItem={openItem}
      onOpenCart={() => setScreen("cart")}
    />
  );
}
