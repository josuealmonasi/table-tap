"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** A breath after the notice: one order moves several dishes at once. */
const SETTLE_MS = 400;

/**
 * Keeps the counts on a till's tiles close to what is actually in the kitchen.
 *
 * The tiles say how many are left. Two people sell at once — a cashier at the
 * counter, a waiter at table six — and the number one of them is reading was
 * true a moment ago. It cannot be made exactly true: between reading a tile
 * and pressing it there is always a gap, and the reservation in the database
 * is what settles who gets the last one. This narrows the gap to about a
 * second, which is the difference between a number worth reading and one that
 * is decoration.
 *
 * The same shape as `useLiveOrders`, for the same reason: the server recomputes
 * and re-renders, rather than the browser keeping a second copy of the stock
 * to drift out of step.
 *
 * Staff only. The diner's menu polls instead (`useMenuFreshness`) — the anon
 * read policy is `available AND menu active`, so the instant a dish sells out
 * the diner loses permission to read that row and Postgres suppresses the very
 * event we would be listening for. Staff read under `works_at`, which does not
 * move when the stock does, so here the subscription works.
 */
export function useLiveStock(restaurantId: string): void {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const bump = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), SETTLE_MS);
    };

    void (async () => {
      // The socket is its own connection and RLS applies to it: without the
      // team's token it subscribes happily and delivers nothing at all.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`live-stock-${restaurantId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "menu_items",
            filter: `restaurant_id=eq.${restaurantId}`,
          },
          bump,
        )
        .subscribe();
    })();

    // And on coming back to the tab, which is when somebody is about to sell
    // something and a stale number would cost them a conversation.
    const onVisible = (): void => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [restaurantId, router]);
}
