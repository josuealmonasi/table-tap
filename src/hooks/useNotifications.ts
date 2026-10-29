"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { useDashboardScope } from "@/components/layout/DashboardCache.react-component";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
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
  timeZone: string;
  notifications: Notification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  loadError: boolean;
}

export interface NotificationData {
  timeZone?: string;
  notifications: Notification[];
  unread: number;
  nextCursor?: string | null;
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
  const { data, mutate, size, setSize } = useSWRInfinite<NotificationData>(
    (index, previous: NotificationData | null) => {
      if (!enabled || !scope || (index > 0 && !previous?.nextCursor)) return null;
      return [index === 0 ? "/api/notifications" : `/api/notifications?before=${encodeURIComponent(previous!.nextCursor!)}`, scope] as const;
    }, readDashboardJson<NotificationData>, { revalidateAll: true },
  );
  const live = useRef(false);
  const loading = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    live.current = enabled && scope !== null;
    return () => { live.current = false; };
  }, [enabled, scope]);

  const markSeen = useCallback((ids: string[]) => {
    if (!enabled || !scope || !live.current || !ids.length) return;
    const seen = new Set(ids);
    const now = new Date().toISOString();
    void mutate(current => {
      if (!current) return current;
      const changed = new Set(current.flatMap(page => page.notifications)
        .filter(n => seen.has(n.id) && !n.read_at).map(n => n.id)).size;
      return current.map(page => ({ ...page,
        notifications: page.notifications.map(n => seen.has(n.id) && !n.read_at ? { ...n, read_at: now } : n),
        unread: Math.max(0, page.unread - changed),
      }));
    }, { revalidate: false });
    // PostgREST puts the ID filter in the URL; keep each batch short enough.
    for (let start = 0; start < ids.length; start += 100) {
      fetch("/api/notifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, ids: ids.slice(start, start + 100), restaurantId: scope.split(":")[2] }),
      }).catch(() => {
        // Left as read on screen; the next poll corrects it if the write failed.
      });
    }
  }, [enabled, scope, mutate]);

  const markRead = useCallback((id: string) => markSeen([id]), [markSeen]);
  const markAllRead = useCallback(() => {
    // The same write and failed-write correction as one entry, for this page.
    markSeen([...new Set(data?.flatMap(page => page.notifications).filter(n => !n.read_at).map(n => n.id) ?? [])]);
  }, [data, markSeen]);
  const loadMore = useCallback(() => {
    if (!enabled || !scope || !live.current || loading.current) return;
    loading.current = true;
    setLoadingMore(true);
    // Track the button's request only. Polling must not repaint the whole nav
    // every time a page starts loading and reset another hook's polling timer.
    const request = loadError ? mutate() : setSize(size + 1);
    void request.then(pages => {
      // A failed revalidation can resolve with old pages instead of rejecting.
      const wanted = loadError ? size : size + 1;
      const incomplete = Boolean(pages?.at(-1)?.nextCursor) && (pages?.length ?? 0) < wanted;
      if (live.current) setLoadError(incomplete);
    }).catch(() => {
      // SWR keeps the last good pages; the button lets this page be tried again.
      if (live.current) setLoadError(true);
    }).finally(() => {
      loading.current = false;
      if (live.current) setLoadingMore(false);
    });
  }, [enabled, scope, loadError, mutate, setSize, size]);
  // Read markers can move a row between pages. Never show it twice.
  const entries = new Map(data?.flatMap(page => page.notifications).map(n => [n.id, n]));
  const notifications = [...entries.values()].sort((a, b) => Number(Boolean(a.read_at)) - Number(Boolean(b.read_at))
    || Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
  return { timeZone: data?.[0]?.timeZone ?? DEFAULT_TIME_ZONE, notifications, unread: data?.[0]?.unread ?? 0, markRead, markAllRead,
    hasMore: Boolean(data?.at(-1)?.nextCursor), loadingMore,
    loadMore, loadError };
}
