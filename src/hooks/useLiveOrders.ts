"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** A breath after the notice: closing a table touches several orders at once
 *  and there is no need to re-render once per order. */
const SETTLE_MS = 400;

/**
 * Keeps a screen up to date when its numbers come from orders.
 *
 * "Free" and "Owes MX$…" are not columns: the server computes them from what
 * is still unpaid. Those screens painted once and stayed there — the waiter
 * collected on Table 3 and the owner, looking at Tables & QR, still saw it as
 * owing, or saw an amount that was no longer true. The only way to find out
 * was to reload.
 *
 * The notice arrives over realtime and all it does is ask the server to paint
 * again. Redoing the arithmetic in the browser would be a second place the
 * same rule lives, and we have had enough of those: this way the number is
 * still computed by whoever always computed it.
 *
 * Also on returning to the tab, which is when somebody is about to act on what
 * they see, and in case a notice was missed while they were away.
 */
export function useLiveOrders(restaurantId: string): void {
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
      // Orders belong to the team under RLS, so the socket has to carry their token
      // or not a single change arrives.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`live-orders-${restaurantId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `restaurant_id=eq.${restaurantId}`,
          },
          bump,
        )
        .subscribe();
    })();

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
