"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orderCode, type Order, type OrderStatus, type Restaurant } from "@/lib/types";

const STATUS_META: Record<string, { label: string; color: string }> = {
  received: { label: "New Order", color: "var(--tt-gold)" },
  preparing: { label: "Preparing", color: "var(--tt-accent)" },
  ready: { label: "Ready", color: "var(--tt-success)" },
  completed: { label: "Completed", color: "var(--tt-muted)" },
};

export default function OrdersBoard({
  restaurant,
  initialOrders,
}: {
  restaurant: Restaurant;
  initialOrders: Order[];
}) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const supabase = createClient();

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: restaurant.currency }).format(n);

  // Realtime: new + updated orders for this restaurant.
  useEffect(() => {
    const channel = supabase
      .channel(`orders-${restaurant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurant.id}` },
        (payload) => {
          const row = payload.new as Order;
          if (!row || row.status === "pending_payment") return;
          setOrders((prev) => {
            const exists = prev.find((o) => o.id === row.id);
            if (exists) return prev.map((o) => (o.id === row.id ? row : o));
            return [row, ...prev];
          });
          // gentle audible ping on a brand-new order
          if (payload.eventType === "INSERT" || (payload.eventType === "UPDATE" && row.status === "received")) {
            try {
              const a = new AudioContext();
              const o = a.createOscillator();
              const g = a.createGain();
              o.connect(g); g.connect(a.destination);
              o.frequency.value = 880; g.gain.value = 0.05;
              o.start(); o.stop(a.currentTime + 0.15);
            } catch {}
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant.id]);

  async function updateStatus(id: string, status: OrderStatus) {
    // optimistic
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  const active = orders.filter((o) => o.status === "received" || o.status === "preparing");
  const revenue = orders.reduce((s, o) => s + (o.paid ? o.total : 0), 0);

  return (
    <div className="tt-dash">
      <header className="tt-dash-head">
        <div>
          <h1 className="tt-serif" style={{ margin: 0 }}>{restaurant.logo} {restaurant.name}</h1>
          <span className="tt-muted" style={{ fontSize: 13 }}>Live Orders</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div className="tt-stat"><strong className="tt-accent">{active.length}</strong><span>Active</span></div>
          <div className="tt-stat"><strong style={{ color: "var(--tt-success)" }}>{fmt(revenue)}</strong><span>Today</span></div>
          <button className="tt-btn tt-btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      {orders.length === 0 ? (
        <div className="tt-empty">
          <div style={{ fontSize: 48 }}>📭</div>
          <strong>No orders yet</strong>
          <p className="tt-muted">New orders appear here in real time.</p>
        </div>
      ) : (
        <div className="tt-orders-grid">
          {orders.map((order) => {
            const meta = STATUS_META[order.status] ?? STATUS_META.completed;
            return (
              <div key={order.id} className="tt-order-card" style={{ borderLeft: `4px solid ${meta.color}` }}>
                <div className="tt-row">
                  <div>
                    <strong style={{ fontSize: 16 }}>Table {order.table_label}</strong>
                    <div className="tt-muted" style={{ fontSize: 12 }}>
                      {orderCode(order.id)} · {new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <span className="tt-status-badge" style={{ color: meta.color, background: `${meta.color}1a` }}>
                    {meta.label}
                  </span>
                </div>

                <div className="tt-order-items">
                  {order.items.map((item, i) => (
                    <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                      <span className="tt-muted">{item.qty}× </span>
                      {item.emoji} {item.name}
                      {Object.keys(item.mods).length > 0 && (
                        <span className="tt-muted" style={{ fontSize: 11 }}>
                          {" "}({Object.values(item.mods).map((v) => (Array.isArray(v) ? v.join(", ") : v)).join(" · ")})
                        </span>
                      )}
                      {item.notes && <div className="tt-accent" style={{ fontSize: 11, fontStyle: "italic" }}>↳ {item.notes}</div>}
                    </div>
                  ))}
                  {order.note && <div className="tt-accent" style={{ fontSize: 12, fontStyle: "italic", marginTop: 6 }}>📝 {order.note}</div>}
                </div>

                <div className="tt-row" style={{ alignItems: "center" }}>
                  <strong className="tt-accent">{fmt(order.total)}</strong>
                  {order.status === "received" && (
                    <button className="tt-btn tt-btn-primary tt-btn-sm" onClick={() => updateStatus(order.id, "preparing")}>Start Preparing</button>
                  )}
                  {order.status === "preparing" && (
                    <button className="tt-btn tt-btn-success tt-btn-sm" onClick={() => updateStatus(order.id, "ready")}>Mark Ready</button>
                  )}
                  {order.status === "ready" && (
                    <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => updateStatus(order.id, "completed")}>Complete</button>
                  )}
                  {order.status === "completed" && <span style={{ color: "var(--tt-success)", fontSize: 13, fontWeight: 700 }}>✓ Done</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
