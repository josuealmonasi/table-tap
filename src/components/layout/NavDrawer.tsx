"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItemsFor } from "@/lib/nav";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";
import { CloseIcon, DashboardIcon, SignOutIcon, NAV_ICONS } from "@/components/ui/icons";

/**
 * Mobile-only navigation: a hamburger button that opens a backdrop drawer
 * (same dimmed overlay as our dialogs) with links to the dashboard and each
 * management area, plus sign out. The current page is highlighted.
 */
export default function NavDrawer({
  restaurantName,
  restaurantLogo,
  role,
}: {
  restaurantName: string;
  restaurantLogo: string | null;
  /** Managers lose Staff/Settings; kitchen only gets the orders board. */
  role: "owner" | "manager" | "waiter" | "kitchen" | "admin";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  async function signOut() {
    await createClient().auth.signOut();
    window.location.assign("/login");
  }

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  return (
    <>
      <button
        type="button"
        className="tt-hamburger"
        aria-label={t("nav.openMenu")}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span />
        <span />
        <span />
      </button>

      {open && (
        <div className="tt-drawer-overlay" onClick={() => setOpen(false)}>
          <aside
            className="tt-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.navigation")}
            onClick={e => e.stopPropagation()}
          >
            <div className="tt-drawer-head">
              <span className="tt-navbar-logo">{restaurantLogo || "🍴"}</span>
              <strong>{restaurantName}</strong>
              <button
                type="button"
                className="tt-drawer-close"
                aria-label={t("nav.closeMenu")}
                onClick={() => setOpen(false)}
              >
                <CloseIcon size={18} weight="bold" />
              </button>
            </div>

            <nav className="tt-drawer-nav">
              {(role === "owner" || role === "manager") && (
                <Link
                  href="/dashboard"
                  className={`tt-drawer-link ${isActive("/dashboard") ? "tt-drawer-link-active" : ""}`}
                  aria-current={isActive("/dashboard") ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <DashboardIcon size={18} className="tt-drawer-emoji" />{" "}
                  {t("nav.dashboard")}
                </Link>
              )}

              {navItemsFor(role).map(item => {
                const Glyph = NAV_ICONS[item.icon];
                return item.soon ? (
                  <span key={item.href} className="tt-drawer-link tt-drawer-link-soon">
                    <Glyph size={18} className="tt-drawer-emoji" /> {t(item.titleKey)}
                    <span className="tt-badge" style={{ marginLeft: "auto" }}>
                      {t("nav.soon")}
                    </span>
                  </span>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`tt-drawer-link ${isActive(item.href) ? "tt-drawer-link-active" : ""}`}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <Glyph size={18} className="tt-drawer-emoji" /> {t(item.titleKey)}
                  </Link>
                );
              })}
            </nav>

            <button
              type="button"
              className="tt-drawer-link tt-drawer-signout"
              onClick={signOut}
            >
              <SignOutIcon size={18} className="tt-drawer-emoji" /> {t("nav.signOut")}
            </button>
          </aside>
        </div>
      )}
    </>
  );
}
