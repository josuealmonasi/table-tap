"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { badgesChanged } from "@/hooks/useBadges";
import { useOnline } from "@/hooks/useOnline";
import { enqueue, readQueue, writeQueue, type QueuedMove } from "@/lib/offline-queue";
import { useT } from "@/lib/i18n/context";
import type { Order, OrderStatus } from "@/lib/types";

/** Short, gentle ping so kitchen staff notice a new order without looking. */
function playPing() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // AudioContext can be blocked before user interaction — safe to ignore.
  }
}

/**
 * Live order feed for one restaurant: seeds from server-rendered orders, keeps
 * them in sync via realtime (pinging on new ones), and exposes a status updater
 * with optimistic UI.
 */
export function useRestaurantOrders(restaurantId: string, initialOrders: Order[]) {
  const t = useT();
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const { online, markOffline } = useOnline();
  const [pending, setPending] = useState<QueuedMove[]>([]);

  // Work from a previous session on this device, still unsent.
  useEffect(() => setPending(readQueue()), []);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    function handleChange(row: Order | undefined, eventType: string) {
      if (!row || row.status === "pending_payment") return;
      setOrders(prev => {
        const exists = prev.find(o => o.id === row.id);
        return exists ? prev.map(o => (o.id === row.id ? row : o)) : [row, ...prev];
      });
      if (eventType === "INSERT" || (eventType === "UPDATE" && row.status === "received"))
        playPing();
    }

    (async () => {
      // Orders are owner-only under RLS, so the realtime socket must carry the
      // owner's token — otherwise every change is filtered out.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`orders-${restaurantId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `restaurant_id=eq.${restaurantId}`,
          },
          payload => handleChange(payload.new as Order, payload.eventType),
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  /**
   * Sends what has been waiting, oldest first.
   *
   * Each move carries the status it started from, so the server drops anything
   * a live connection has already overtaken. A move that fails to send stays in
   * the queue; one the server refuses as superseded does not, because the board
   * it was arguing with is newer than it is.
   */
  const flush = useCallback(async () => {
    const queue = readQueue();
    if (queue.length === 0) return;

    const stuck: QueuedMove[] = [];
    for (const move of queue) {
      try {
        const res = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: move.id, status: move.to, from: move.from }),
        });
        if (!res.ok) stuck.push(move);
      } catch {
        stuck.push(move); // still no connection: keep it for next time
      }
    }
    writeQueue(stuck);
    setPending(stuck);
    badgesChanged();
  }, []);

  // Coming back is the moment to send, and the board reloads itself after so
  // what everyone else did while we were away lands too.
  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  async function updateStatus(id: string, status: OrderStatus) {
    const was = orders.find(o => o.id === id)?.status;
    setOrders(prev => prev.map(o => (o.id === id ? { ...o, status } : o))); // optimistic

    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // The tap used to be fired and forgotten: on a dropped connection the
      // ticket showed as moved to whoever moved it and untouched to everybody
      // else. Hold it instead, and say so on the board.
      if (was) {
        const queue = enqueue(readQueue(), { id, from: was, to: status, at: Date.now() });
        writeQueue(queue);
        setPending(queue);
      }
      markOffline();
    }

    // The board's own count changed, so the tab's should too.
    badgesChanged();
  }

  /**
   * Cancels (and refunds, if paid) an order. NOT optimistic — money moves, so
   * we wait for the server. Returns an error message to show, or null on success.
   */
  async function cancelOrder(id: string): Promise<string | null> {
    try {
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) return data.error ?? t("apiErr.orderCancel");
      badgesChanged();
      setOrders(prev => prev.map(o => (o.id === id ? { ...o, status: "cancelled" } : o)));
      return null;
    } catch {
      // Cancelling refunds money, so it is never queued and never optimistic:
      // a refund replayed on reconnect is a refund given twice.
      markOffline();
      return t("offline.blocked");
    }
  }

  return { orders, updateStatus, cancelOrder, online, pending: pending.length };
}
