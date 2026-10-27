"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { badgesChanged } from "@/hooks/useBadges";
import { useOnline } from "@/hooks/useOnline";
import { enqueue, readQueue, writeQueue, type QueuedMove } from "@/lib/offline-queue";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import type { OrderStatus } from "@/lib/types";
import { isPreparationOrder, type BoardOrder } from "@/lib/kitchen-ticket";
import type { CancelSummary } from "@/lib/cancel-plan";

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
export function useRestaurantOrders(restaurantId: string, initialOrders: BoardOrder[], kitchen = false) {
  const t = useT();
  const toast = useToast();
  const [orders, setOrders] = useState<BoardOrder[]>(initialOrders);
  // A refresh brings a new server snapshot, and today's takings are its base
  // plus what this list holds. Kept from the first render, the list still
  // carried a completed MX$100 order the base had already counted: MX$200 shown
  // for MX$100 paid (audit M, finding 2). Each new snapshot replaces the list,
  // so both cover the same rows; realtime carries on from there.
  const [seeded, setSeeded] = useState(initialOrders);
  if (seeded !== initialOrders) {
    setSeeded(initialOrders);
    setOrders(initialOrders);
  }
  const { online, markOffline } = useOnline();
  const [pending, setPending] = useState<QueuedMove[]>([]);
  // A refused stale tap can retire a card even when its realtime event was missed.
  // Keep the order itself: paid rows still contribute to today's takings.
  const [inactiveOrderIds, setInactiveOrderIds] = useState<Set<string>>(new Set());
  function hideInactive(id: string): void {
    setInactiveOrderIds(ids => new Set(ids).add(id));
  }

  // Work from a previous session on this device, still unsent.
  useEffect(() => setPending(readQueue()), []);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    function handleChange(row: BoardOrder | undefined, eventType: string) {
      if (!row || row.status === "pending_payment") return;
      setOrders(prev => {
        const exists = prev.find(o => o.id === row.id);
        return exists ? prev.map(o => (o.id === row.id ? row : o)) : [row, ...prev];
      });
      if (isPreparationOrder(row) && (eventType === "INSERT" || (eventType === "UPDATE" && row.status === "received")))
        playPing();
    }

    (async () => {
      // RLS checks the socket too: the kitchen reads tickets and the floor
      // reads orders, both with their own current session.
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
            table: kitchen ? "kitchen_tickets" : "orders",
            filter: `restaurant_id=eq.${restaurantId}`,
          },
          payload => handleChange(payload.new as BoardOrder, payload.eventType),
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [restaurantId, kitchen]);

  /**
   * Sends what has been waiting, oldest first.
   *
   * Each move carries the status it started from, so the server drops anything
   * a live connection has already overtaken. A move that fails to send stays in
   * the queue, and so does every later step for that order: a later step cannot
   * overtake one that still has to be sent. One the server refuses does not
   * stay, because the board it was arguing with is newer than it is.
   */
  const flush = useCallback(async () => {
    const queue = readQueue();
    if (queue.length === 0) return;

    const stuck: QueuedMove[] = [];
    let refused = 0;
    const blocked = new Set<string>();
    for (const move of queue) {
      // A later step cannot overtake one that still needs to be sent.
      if (blocked.has(move.id)) { stuck.push(move); continue; }
      try {
        const res = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: move.id, status: move.to, from: move.from }),
        });
        // A server that is failing may answer differently later; one that
        // refused has answered. Kept, a refused move was retried on every
        // reconnect and the board said "saved, will be sent" for ever.
        if (res.status >= 500) {
          stuck.push(move);
          blocked.add(move.id);
        } else if (!res.ok) {
          refused++;
          const data = await res.json().catch(() => ({}));
          if (data.inactive === true) setInactiveOrderIds(ids => new Set(ids).add(move.id));
        }
      } catch {
        stuck.push(move); // still no connection: keep it for next time
        blocked.add(move.id);
      }
    }
    writeQueue(stuck);
    setPending(stuck);
    if (refused > 0) toast(t("orders.queuedRefused", { n: refused }), "error");
    badgesChanged();
  }, [t, toast]);

  // Coming back is the moment to send, and the board reloads itself after so
  // what everyone else did while we were away lands too.
  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  async function updateStatus(id: string, status: OrderStatus) {
    const was = orders.find(o => o.id === id)?.status;
    setOrders(prev => prev.map(o => (o.id === id ? { ...o, status } : o))); // optimistic

    let res: Response;
    try {
      res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, from: was }),
      });
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
      badgesChanged();
      return;
    }

    // Answered, and refused: not a dropped connection. It was held as one — a
    // board that was online told "saved, will be sent", the ticket moved here
    // and nowhere else, the move refused again on every reconnect. It goes
    // back to where it was, with the server's reason.
    if (!res.ok) {
      if (was) setOrders(prev => prev.map(o => (o.id === id ? { ...o, status: was } : o)));
      const data = (await res.json().catch(() => ({}))) as { error?: string; inactive?: boolean };
      if (data.inactive === true) hideInactive(id);
      toast(data.error ?? t("orders.moveRefused"), "error");
    }

    // The board's own count changed, so the tab's should too.
    badgesChanged();
  }

  /**
   * What cancelling would give back, and who would give it — asked before the
   * dialog opens, so its offer is the server's own. Returns an error message
   * instead when it cannot be told: offering a refund on a guess is how the
   * dialog promised money back that the cancel then refused to give.
   */
  async function cancelPlanFor(id: string): Promise<CancelSummary | string> {
    try {
      const res = await fetch(`/api/orders/cancel?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      return res.ok ? (data as CancelSummary) : (data.error ?? t("apiErr.orderCancel"));
    } catch {
      markOffline();
      return t("offline.blocked");
    }
  }

  /**
   * Cancels (and refunds, if paid) an order. NOT optimistic — money moves, so
   * we wait for the server. A conflict needs a fresh offer, confirmed again.
   */
  async function cancelOrder(id: string): Promise<{ error: string; stale: boolean } | null> {
    try {
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? t("apiErr.orderCancel"), stale: res.status === 409 };
      badgesChanged();
      setOrders(prev => prev.map(o => (o.id === id ? { ...o, status: "cancelled" } : o)));
      return null;
    } catch {
      // Cancelling refunds money, so it is never queued and never optimistic:
      // a refund replayed on reconnect is a refund given twice.
      markOffline();
      return { error: t("offline.blocked"), stale: false };
    }
  }

  return { orders, inactiveOrderIds, hideInactive, updateStatus, cancelOrder, cancelPlanFor, online, pending: pending.length };
}
