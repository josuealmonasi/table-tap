"use client";

import { useEffect, useState } from "react";
import { useFinishedOrders } from "@/hooks/useOrderFinished";
import { forgetOrder, recallActiveOrders } from "@/lib/recent-order";
import { recallSitting } from "@/lib/table-binding";
import type { TrackedOrder } from "@/lib/order-tracking";

export interface TrackedOrders {
  /** Every order this phone can still watch, newest first. */
  trackIds: string[];
  /** Puts a just-placed order at the front of the list. */
  track: (orderId: string) => void;
  /** Which sitting this phone belongs to, at this table. */
  sittingSessionId: string | null;
  setSittingSessionId: (id: string | null) => void;
  /** Which order the tracker is showing, if it is open. */
  tracking: string | null;
  setTracking: (id: string | null) => void;
  closeTracker: () => void;
}

/**
 * The orders this phone placed and can still watch, the sitting it belongs to,
 * and the tracker over the menu.
 *
 * Held where orders are placed, so one appears the moment it is — read only by
 * the menu, it was seeded once on mount and a dine-in order never showed up at
 * all. A list rather than one slot: a counter has no table to hang a running
 * tab on, so "one more thing" is always a NEW order, and losing the first one
 * to the second is exactly what used to happen.
 */
export function useTrackedOrders(
  restaurantId: string,
  tableId: string | null,
  trackOrder: TrackedOrder | null,
): TrackedOrders {
  const [trackIds, setTrackIds] = useState<string[]>(
    trackOrder?.id ? [trackOrder.id] : [],
  );
  // Dividing a bill is addressed to the sitting rather than the table:
  // tonight's diners must not inherit a split from whoever sat here before.
  const [sittingSessionId, setSittingSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!tableId) return;
    const sitting = recallSitting(restaurantId);
    setSittingSessionId(sitting?.tableId === tableId ? sitting.sessionId : null);
  }, [restaurantId, tableId]);
  useEffect(() => {
    setTrackIds(prev =>
      prev.length > 0 ? prev : recallActiveOrders(restaurantId, tableId ?? undefined),
    );
  }, [restaurantId, tableId]);

  // Each withdraws itself as it is delivered, and the others stay: a diner
  // whose drink arrives before their food should keep watching the food. If
  // the tracker is open it does not close — the diner deserves to see "ready".
  const finished = useFinishedOrders(trackIds);
  const finishedKey = finished.join(",");
  useEffect(() => {
    if (!finishedKey) return;
    for (const id of finishedKey.split(",")) forgetOrder(restaurantId, tableId, id);
    setTrackIds(prev => prev.filter(id => !finishedKey.split(",").includes(id)));
  }, [finishedKey, restaurantId, tableId]);

  // Landing on /order/<id> opens the tracker straight away; from the menu the
  // banner opens it, over the menu, without going anywhere.
  const [tracking, setTracking] = useState<string | null>(trackOrder?.id ?? null);

  function closeTracker(): void {
    setTracking(null);
    // Arriving on /order/<id> leaves that in the address bar with the menu on
    // screen, so a refresh — or a share — would reopen a tracker the diner has
    // closed. Swapping it for the menu's own URL, without a navigation, keeps
    // the bar honest and the page as it is.
    if (trackOrder) {
      const menuHref = `/r/${trackOrder.restaurant_id}${trackOrder.table_id ? `/t/${trackOrder.table_id}` : ""}`;
      window.history.replaceState(null, "", menuHref);
    }
  }

  function track(orderId: string): void {
    setTrackIds(prev => [orderId, ...prev.filter(id => id !== orderId)]);
  }

  return {
    trackIds,
    track,
    sittingSessionId,
    setSittingSessionId,
    tracking,
    setTracking,
    closeTracker,
  };
}
