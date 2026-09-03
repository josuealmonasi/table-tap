"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { NotificationsIcon } from "@/components/ui/icons";

/**
 * The bell in the nav.
 *
 * Owner and manager only, which is the same line the API and the table's RLS
 * policy draw — a warning that a dish is running out is only useful to somebody
 * who can order more of it.
 *
 * Reading one does not remove it. The list is the last ten either way, newest
 * first, and read ones stay so that "what was that about?" has an answer an
 * hour later.
 */
export default function NotificationsMenu({ enabled }: { enabled: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { notifications, unread, markRead, markAllRead } = useNotifications(enabled);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  if (!enabled) return null;

  /**
   * The sentence, built when it is read rather than when it was raised.
   *
   * The row stores what happened and to which dish; a restaurant that switches
   * the dashboard to English should not find last week's warnings still in
   * Spanish.
   */
  function sentence(n: Notification): string {
    const name = n.data.name ?? "";
    const count = n.data.stock ?? 0;
    return n.kind === "out_of_stock"
      ? t("notif.outOfStock", { name })
      : t("notif.lowStock", { name, count });
  }

  return (
    <div className="tt-user-menu" ref={menuRef}>
      <button
        type="button"
        className="tt-user-btn tt-notif-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={
          unread > 0 ? `${t("notif.open")} · ${t("notif.unread", { count: unread })}` : t("notif.open")
        }
        onClick={() => setOpen(o => !o)}
      >
        <NotificationsIcon size={18} weight="bold" />
        {unread > 0 && (
          <span className="tt-notif-dot" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="tt-user-dropdown tt-notif-dropdown" role="menu">
          <div className="tt-notif-head">
            <strong>{t("notif.title")}</strong>
            {unread > 0 && (
              <button type="button" className="tt-notif-readall" onClick={markAllRead}>
                {t("notif.markAllRead")}
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="tt-notif-empty tt-muted">{t("notif.empty")}</p>
          ) : (
            <ul className="tt-notif-list">
              {notifications.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={`tt-notif-item ${n.read_at ? "" : "tt-notif-unread"}`}
                    onClick={() => !n.read_at && markRead(n.id)}
                    title={n.read_at ? undefined : t("notif.markRead")}
                  >
                    <span className="tt-notif-text">{sentence(n)}</span>
                    <span className="tt-notif-when tt-muted">
                      {new Date(n.created_at).toLocaleString([], {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
