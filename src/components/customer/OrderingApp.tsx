"use client";

import { useMemo, useState } from "react";
import type {
  Category,
  MenuItem,
  OrderLineItem,
  Restaurant,
  RestaurantTable,
} from "@/lib/types";
import { useCart } from "@/hooks/useCart";
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
  const cart = useCart(restaurant);

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
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: restaurant.id,
          tableId: table?.id ?? null,
          tableLabel: table?.label ?? null,
          items: cart.items.map((c) => ({
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
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // Stripe Checkout
      } else {
        alert(data.error ?? "Something went wrong");
        setLoading(false);
      }
    } catch {
      alert("Network error — please try again");
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
      <CartScreen
        restaurant={restaurant}
        table={table}
        items={cart.items}
        subtotal={cart.subtotal}
        serviceFee={cart.serviceFee}
        total={cart.total}
        orderNote={orderNote}
        loading={loading}
        onChangeNote={setOrderNote}
        onRemoveItem={cart.removeItem}
        onAddMore={() => setScreen("menu")}
        onCheckout={checkout}
      />
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
