"use client";

import { useCallback, useEffect, useState } from "react";

/** One row from the bell, as the API returns it. */
export interface Notification {
  id: string;
  kind: "low_stock" | "out_of_stock";
  /** The facts the sentence is built from — never the sentence itself. */
  data: { itemId?: string; name?: string; stock?: number };
  read_at: string | null;
  created_at: string;
}

interface NotificationsState {
  notifications: Notification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const read = useCallback(() => {
    if (!enabled) return;
    fetch("/api/notifications")
      .then(r => (r.ok ? r.json() : { notifications: [], unread: 0 }))
      .then((d: { notifications?: Notification[]; unread?: number }) => {
        setNotifications(d.notifications ?? []);
        setUnread(d.unread ?? 0);
      })
      .catch(() => {
        // A bell we could not fetch simply shows what it last knew.
      });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(read, 30_000);
    read();
    const onFocus = () => read();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, read]);

  const markRead = useCallback((id: string) => {
    const now = new Date().toISOString();
    setNotifications(list =>
      list.map(n => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)),
    );
    setUnread(n => Math.max(0, n - 1));
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {
      // Left as read on screen; the next poll corrects it if the write failed.
    });
  }, []);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications(list => list.map(n => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {
      // Same as above.
    });
  }, []);

  return { notifications, unread, markRead, markAllRead };
}
