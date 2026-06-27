"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orderCode, type Order, type OrderStatus } from "@/lib/types";

const STEPS: { key: OrderStatus; label: string; emoji: string }[] = [
  { key: "received", label: "Order Received", emoji: "📋" },
  { key: "preparing", label: "Preparing", emoji: "👨‍🍳" },
  { key: "ready", label: "Ready!", emoji: "🍱" },
];

export default function OrderTracker({ initialOrder }: { initialOrder: Order }) {
  const [order, setOrder] = useState<Order>(initialOrder);

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: order.currency }).format(n);

  // Subscribe to realtime updates on this specific order.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`order-${order.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${order.id}` },
        (payload) => setOrder(payload.new as Order)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [order.id]);

  const displayStatus: OrderStatus =
    order.status === "completed" ? "ready" : order.status === "pending_payment" ? "received" : order.status;
  const idx = STEPS.findIndex((s) => s.key === displayStatus);

  const headline =
    displayStatus === "ready"
      ? "Your order is ready!"
      : displayStatus === "preparing"
      ? "Chef is preparing it"
      : "Order received!";
  const headEmoji = displayStatus === "ready" ? "🍱" : displayStatus === "preparing" ? "👨‍🍳" : "📋";

  return (
    <div className="tt-root">
      <div className="tt-track-hero">
        <div style={{ fontSize: 48 }}>{headEmoji}</div>
        <h2 className="tt-serif" style={{ margin: 0, fontSize: 22 }}>{headline}</h2>
        <div className="tt-sage" style={{ fontSize: 13, marginTop: 4 }}>{orderCode(order.id)}</div>
      </div>

      <div style={{ padding: 20 }}>
        <div className="tt-card" style={{ padding: 20 }}>
          <div className="tt-tracker">
            {STEPS.map((step, i) => {
              const done = i < idx;
              const active = i === idx;
              return (
                <div key={step.key} className="tt-step-wrap">
                  <div className="tt-step">
                    <div className={`tt-step-dot ${active ? "tt-step-active" : done ? "tt-step-done" : ""}`}>
                      {step.emoji}
                    </div>
                    <span className={`tt-step-label ${active ? "tt-step-label-active" : done ? "tt-step-label-done" : ""}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && <div className={`tt-step-line ${done ? "tt-step-line-done" : ""}`} />}
                </div>
              );
            })}
          </div>
          {displayStatus !== "ready" ? (
            <div className="tt-muted" style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
              ⏱ Estimated wait: 15–20 min
            </div>
          ) : (
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 14, fontWeight: 700, color: "var(--tt-success)" }}>
              🎉 Our team will bring it to Table {order.table_label}!
            </div>
          )}
        </div>

        <div className="tt-card" style={{ padding: 16, marginTop: 16 }}>
          <strong>Your items</strong>
          <div style={{ marginTop: 12 }}>
            {order.items.map((item, i) => (
              <div key={i} className="tt-row" style={{ fontSize: 14, marginBottom: 8 }}>
                <span>{item.qty}× {item.emoji} {item.name}</span>
                <span className="tt-muted">{fmt(item.price * item.qty)}</span>
              </div>
            ))}
          </div>
          <div className="tt-row tt-total"><span>Total paid</span><span className="tt-accent">{fmt(order.total)}</span></div>
        </div>
      </div>
    </div>
  );
}
