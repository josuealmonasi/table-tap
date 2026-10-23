"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { useDashboardScope } from "@/components/layout/DashboardCache.react-component";
import { readDashboardJson } from "@/lib/dashboard-read";

/** One row from the bell, as the API returns it. */
export interface Notification {
  id: string;
  kind: "low_stock" | "out_of_stock" | "refund_due";
  /** The facts the sentence is built from — never the sentence itself. */
  data: { itemId?: string; name?: string; stock?: number; amount?: number; currency?: string; table?: string | null; account?: string | null };
  read_at: string | null;
  created_at: string;
}

interface NotificationsState {
  notifications: Notification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

interface NotificationData {
  notifications: Notification[];
  unread: number;
}

/**
 * What the bell knows, kept roughly current.
 *
 * Polled on the same slow timer as the nav counts, and for the same reason: a
 * stock warning that arrives half a minute late costs nothing, and a socket per
 * dashboard tab to carry one would cost rather a lot. Refreshed when the tab
 * comes back to the front, which is the moment somebody returns from the floor
 * and might have missed something.
 *
 * Marking read is optimistic — the row is already greyed before the write
 * lands, because the alternative is a menu item that stays bold for a second
 * after you click it and teaches people to click it twice.
 */
export function useNotifications(enabled: boolean): NotificationsState {
  const scope = useDashboardScope();
  const key = enabled && scope ? ["/api/notifications", scope] as const : null;
  const { data, mutate } = useSWR(key, readDashboardJson<NotificationData>);
  const live = useRef(false);
  useEffect(() => {
    live.current = enabled && scope !== null;
    return () => { live.current = false; };
  }, [enabled, scope]);

  const markRead = useCallback((id: string) => {
    if (!enabled || !scope || !live.current) return;
    const now = new Date().toISOString();
    void mutate(current => {
      if (!current || !current.notifications.some(n => n.id === id && !n.read_at)) return current;
      return {
        notifications: current.notifications.map(n => n.id === id && !n.read_at ? { ...n, read_at: now } : n),
        unread: Math.max(0, current.unread - 1),
      };
    }, { revalidate: false });
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, restaurantId: scope.split(":")[2] }),
    }).catch(() => {
      // Left as read on screen; the next poll corrects it if the write failed.
    });
  }, [enabled, scope, mutate]);

  const markAllRead = useCallback(() => {
    if (!enabled || !scope || !live.current) return;
    const now = new Date().toISOString();
    void mutate(current => current ? {
      notifications: current.notifications.map(n => n.read_at ? n : { ...n, read_at: now }),
      unread: 0,
    } : current, { revalidate: false });
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true, restaurantId: scope.split(":")[2] }),
    }).catch(() => {
      // Same as above.
    });
  }, [enabled, scope, mutate]);

  return { notifications: data?.notifications ?? [], unread: data?.unread ?? 0, markRead, markAllRead };
}
