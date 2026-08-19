"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { menuSlug } from "@/lib/slug";
import { useT } from "@/lib/i18n/context";

interface MenuLink {
  id: string;
  name: string;
  active: boolean;
}

/**
 * The restaurant's menus, one hover away from the Menús tab.
 *
 * A shortcut, never the only road: the tab itself still opens the page that
 * lists them, so nothing here is reachable *only* by hovering. That matters
 * more than it sounds — hover does not exist on a phone, and it does not
 * exist for anyone driving the dashboard from the keyboard, so a hover-only
 * door is a door some people can see and never open. Focus opens it too, and
 * on a phone it is not rendered at all: tapping through lands on the list.
 *
 * Scoped to this restaurant. The menus table is deliberately world-readable
 * so a diner's phone can load a menu, which means an unscoped query here
 * quietly lists the neighbours.
 *
 * The menus are fetched on first hover rather than with the page. Every
 * dashboard screen carries this bar, and most visits never open it — a query
 * on every page load to fill a panel nobody looked at is rent paid for
 * nothing. RLS scopes the read to the caller's own restaurant.
 */
export default function MenusMenu({
  restaurantId,
  children,
}: {
  restaurantId: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [menus, setMenus] = useState<MenuLink[] | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(): Promise<void> {
    if (menus) return; // asked once per page
    const { data } = await createClient()
      .from("menus")
      .select("id, name, active")
      // Menus are readable by anyone — the diner's screen needs them — so
      // without this the bar listed every restaurant's menus, five "Main Menu"
      // rows deep, each linking to whichever one owned the slug.
      .eq("restaurant_id", restaurantId)
      .order("sort_order");
    setMenus((data as MenuLink[]) ?? []);
  }

  function show(): void {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    void load();
  }

  function hide(): void {
    // A moment's grace, so crossing the gap between the tab and the panel
    // below it doesn't snatch the panel away mid-reach.
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <div
      className="tt-menus-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={e => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {children}
      {open && (
        <div className="tt-user-dropdown tt-menus-dropdown" role="menu">
          {menus === null ? (
            <span className="tt-menus-note">{t("common.loading")}</span>
          ) : menus.length === 0 ? (
            <span className="tt-menus-note">{t("nav.menusEmpty")}</span>
          ) : (
            menus.map(menu => (
              <Link
                key={menu.id}
                href={`/dashboard/${menuSlug(menu.name)}`}
                className="tt-user-item"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <span>{menu.name}</span>
                {/* A paused menu is not serving anybody, and that is worth
                    knowing before clicking into it. */}
                {!menu.active && (
                  <span className="tt-menus-paused">{t("nav.menuPaused")}</span>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
