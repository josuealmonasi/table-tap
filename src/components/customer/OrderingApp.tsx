"use client";

import { useMemo, useState } from "react";
import type {
  Category,
  MenuItem,
  Modifier,
  Restaurant,
  RestaurantTable,
  OrderLineItem,
} from "@/lib/types";

type CartItem = OrderLineItem & { cartId: number };

export default function OrderingApp({
  restaurant,
  table,
  categories,
  items,
}: {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  categories: Category[];
  items: MenuItem[];
}) {
  const [screen, setScreen] = useState<"menu" | "item" | "cart">("menu");
  const [activeCat, setActiveCat] = useState<string>("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [mods, setMods] = useState<Record<string, string | string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [loading, setLoading] = useState(false);

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: restaurant.currency }).format(n);

  const filtered = useMemo(
    () => (activeCat === "all" ? items : items.filter((i) => i.category_id === activeCat)),
    [activeCat, items]
  );

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const serviceFee = +(subtotal * (restaurant.service_pct / 100)).toFixed(2);
  const total = subtotal + serviceFee;
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  function openItem(item: MenuItem) {
    setSelected(item);
    setMods({});
    setQty(1);
    setNotes("");
    setScreen("item");
  }

  function toggleMod(label: string, option: string, type: Modifier["type"]) {
    setMods((prev) => {
      if (type === "single") return { ...prev, [label]: option };
      const cur = (prev[label] as string[]) ?? [];
      return {
        ...prev,
        [label]: cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option],
      };
    });
  }

  function addToCart() {
    if (!selected) return;
    setCart((prev) => [
      ...prev,
      {
        cartId: Date.now(),
        itemId: selected.id,
        name: selected.name,
        emoji: selected.emoji,
        price: selected.price,
        qty,
        mods,
        notes: notes || undefined,
      },
    ]);
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
          items: cart.map((c) => ({
            itemId: c.itemId,
            name: c.name,
            emoji: c.emoji,
            price: c.price,
            qty: c.qty,
            mods: c.mods,
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

  // ── ITEM DETAIL ──
  if (screen === "item" && selected) {
    return (
      <div className="tt-root">
        <div className="tt-item-hero">
          <span>{selected.emoji}</span>
          <button className="tt-back" onClick={() => setScreen("menu")}>←</button>
        </div>
        <div style={{ padding: 20 }}>
          <div className="tt-row">
            <h2 className="tt-serif" style={{ margin: 0, fontSize: 24 }}>{selected.name}</h2>
            <span className="tt-price-lg">{fmt(selected.price)}</span>
          </div>
          <p className="tt-muted" style={{ lineHeight: 1.6 }}>{selected.description}</p>

          {selected.modifiers.map((mod) => (
            <div key={mod.label} style={{ marginBottom: 20 }}>
              <div className="tt-mod-label">
                {mod.label}
                {mod.type === "multi" && <span className="tt-muted"> (choose any)</span>}
              </div>
              <div className="tt-chips">
                {mod.options.map((opt) => {
                  const sel =
                    mod.type === "single"
                      ? mods[mod.label] === opt
                      : ((mods[mod.label] as string[]) ?? []).includes(opt);
                  return (
                    <button
                      key={opt}
                      className={`tt-chip ${sel ? "tt-chip-on" : ""}`}
                      onClick={() => toggleMod(mod.label, opt, mod.type)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: 20 }}>
            <div className="tt-mod-label">Special requests</div>
            <textarea
              className="tt-input"
              rows={2}
              placeholder="Allergies, preferences…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div className="tt-stepper">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
            <button className="tt-btn tt-btn-primary" style={{ flex: 1 }} onClick={addToCart}>
              Add to cart — {fmt(selected.price * qty)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── CART ──
  if (screen === "cart") {
    return (
      <div className="tt-root">
        <div className="tt-header">
          <button className="tt-back-inline" onClick={() => setScreen("menu")}>←</button>
          <h2 className="tt-serif" style={{ margin: 0, fontSize: 20 }}>Your Order</h2>
          {table && <span className="tt-badge">Table {table.label}</span>}
        </div>
        <div style={{ padding: 16 }}>
          {cart.length === 0 && <p className="tt-muted">Your cart is empty.</p>}
          {cart.map((item) => (
            <div key={item.cartId} className="tt-card" style={{ padding: 14 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <span style={{ fontSize: 28 }}>{item.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div className="tt-row">
                    <strong>{item.qty}× {item.name}</strong>
                    <strong className="tt-accent">{fmt(item.price * item.qty)}</strong>
                  </div>
                  {Object.entries(item.mods).map(([k, v]) => (
                    <div key={k} className="tt-muted" style={{ fontSize: 12 }}>
                      {k}: {Array.isArray(v) ? v.join(", ") : v}
                    </div>
                  ))}
                  {item.notes && <div className="tt-muted" style={{ fontSize: 12, fontStyle: "italic" }}>&ldquo;{item.notes}&rdquo;</div>}
                </div>
                <button className="tt-x" onClick={() => setCart((p) => p.filter((c) => c.cartId !== item.cartId))}>×</button>
              </div>
            </div>
          ))}

          <button className="tt-add-more" onClick={() => setScreen("menu")}>+ Add more items</button>

          <div style={{ marginBottom: 20 }}>
            <div className="tt-mod-label">Note for the kitchen</div>
            <textarea
              className="tt-input"
              rows={2}
              placeholder="Any notes for the whole order?"
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
            />
          </div>

          <div className="tt-card" style={{ padding: 16 }}>
            <div className="tt-row"><span className="tt-muted">Subtotal</span><span>{fmt(subtotal)}</span></div>
            {restaurant.service_pct > 0 && (
              <div className="tt-row" style={{ marginTop: 8 }}>
                <span className="tt-muted">Service ({restaurant.service_pct}%)</span><span>{fmt(serviceFee)}</span>
              </div>
            )}
            <div className="tt-row tt-total"><span>Total</span><span className="tt-accent">{fmt(total)}</span></div>
          </div>

          <button
            className="tt-btn tt-btn-primary tt-btn-lg"
            style={{ width: "100%", marginTop: 20 }}
            disabled={cart.length === 0 || loading}
            onClick={checkout}
          >
            {loading ? "Redirecting to payment…" : "Proceed to Payment"}
          </button>
          <p className="tt-muted" style={{ textAlign: "center", fontSize: 12, marginTop: 12 }}>
            🔒 Secured by Stripe · card, Apple Pay & Google Pay
          </p>
        </div>
      </div>
    );
  }

  // ── MENU ──
  return (
    <div className="tt-root">
      <div className="tt-menu-header">
        <div className="tt-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 26 }}>{restaurant.logo}</div>
            <div className="tt-serif" style={{ fontSize: 22, fontWeight: 700 }}>{restaurant.name}</div>
            <div className="tt-sage" style={{ fontSize: 13 }}>{restaurant.tagline}</div>
          </div>
          {table && <span className="tt-badge tt-badge-gold">🪑 Table {table.label}</span>}
        </div>
        <div className="tt-cats">
          <button className={`tt-cat ${activeCat === "all" ? "tt-cat-on" : ""}`} onClick={() => setActiveCat("all")}>All</button>
          {categories.map((c) => (
            <button key={c.id} className={`tt-cat ${activeCat === c.id ? "tt-cat-on" : ""}`} onClick={() => setActiveCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {filtered.map((item) => (
          <div key={item.id} className="tt-card tt-item" onClick={() => openItem(item)}>
            <div className="tt-thumb">{item.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <strong style={{ fontSize: 15 }}>{item.name}</strong>
                {item.popular && <span className="tt-pop">Popular</span>}
              </div>
              <div className="tt-desc tt-muted">{item.description}</div>
              <div className="tt-accent" style={{ fontWeight: 700, fontSize: 16 }}>{fmt(item.price)}</div>
            </div>
            <div className="tt-plus">+</div>
          </div>
        ))}
      </div>

      {cartCount > 0 && (
        <div className="tt-fab-wrap">
          <button className="tt-fab" onClick={() => setScreen("cart")}>
            <span className="tt-fab-count">{cartCount}</span>
            <span>View Cart</span>
            <span>{fmt(total)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
