"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import { createClient } from "@/lib/supabase/client";

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
  restaurantLogo: string;
  /** Staff only get the orders board — no dashboard, menus or management links. */
  role: "owner" | "staff";
}) {
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
        aria-label="Open navigation menu"
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
            aria-label="Navigation"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tt-drawer-head">
              <span className="tt-navbar-logo">{restaurantLogo || "🍴"}</span>
              <strong>{restaurantName}</strong>
              <button
                type="button"
                className="tt-drawer-close"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>

            <nav className="tt-drawer-nav">
              {role === "owner" && (
                <Link
                  href="/dashboard"
                  className={`tt-drawer-link ${isActive("/dashboard") ? "tt-drawer-link-active" : ""}`}
                  aria-current={isActive("/dashboard") ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className="tt-drawer-emoji">🏠</span> Dashboard
                </Link>
              )}

              {NAV_ITEMS.filter((item) => role === "owner" || item.href === "/dashboard/orders").map((item) =>
                item.soon ? (
                  <span key={item.title} className="tt-drawer-link tt-drawer-link-soon">
                    <span className="tt-drawer-emoji">{item.emoji}</span> {item.title}
                    <span className="tt-badge" style={{ marginLeft: "auto" }}>Soon</span>
                  </span>
                ) : (
                  <Link
                    key={item.title}
                    href={item.href}
                    className={`tt-drawer-link ${isActive(item.href) ? "tt-drawer-link-active" : ""}`}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <span className="tt-drawer-emoji">{item.emoji}</span> {item.title}
                  </Link>
                )
              )}
            </nav>

            <button type="button" className="tt-drawer-link tt-drawer-signout" onClick={signOut}>
              <span className="tt-drawer-emoji">🚪</span> Sign out
            </button>
          </aside>
        </div>
      )}
    </>
  );
}
