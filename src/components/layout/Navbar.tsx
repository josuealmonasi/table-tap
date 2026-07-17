"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import NavDrawer from "./NavDrawer";

/**
 * Site-wide nav for logged-in restaurant users: brand top-left, user menu
 * top-right (profile / settings — coming soon — and sign out).
 */
export default function Navbar({
  restaurantName,
  restaurantLogo,
  role,
}: {
  restaurantName: string;
  restaurantLogo: string;
  /** Managers lose Settings/Staff; waiter/kitchen only get the orders board. */
  role: "owner" | "manager" | "waiter" | "kitchen" | "admin";
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  async function signOut() {
    await createClient().auth.signOut();
    window.location.assign("/login");
  }

  return (
    <nav className="tt-navbar">
      <div className="container tt-navbar-inner">
        <div className="tt-navbar-left">
          <NavDrawer
            restaurantName={restaurantName}
            restaurantLogo={restaurantLogo}
            role={role}
          />
          <Link
            href={
              role === "admin"
                ? "/dashboard/admin"
                : role === "kitchen" || role === "waiter"
                  ? "/dashboard/orders"
                  : "/dashboard"
            }
            className="tt-navbar-brand"
          >
            <span className="tt-navbar-logo">{restaurantLogo || "🍴"}</span>
            <strong>{restaurantName}</strong>
          </Link>
        </div>

        <div className="tt-user-menu" ref={menuRef}>
          <button
            type="button"
            className="tt-user-btn"
            aria-haspopup="true"
            aria-expanded={open}
            aria-label="Account menu"
            onClick={() => setOpen(o => !o)}
          >
            👤
          </button>

          {open && (
            <div className="tt-user-dropdown" role="menu">
              <Link
                href="/dashboard/profile"
                role="menuitem"
                className="tt-user-item"
                onClick={() => setOpen(false)}
              >
                Profile
              </Link>
              {role === "owner" && (
                <Link
                  href="/dashboard/settings"
                  role="menuitem"
                  className="tt-user-item"
                  onClick={() => setOpen(false)}
                >
                  Settings
                </Link>
              )}
              <div className="tt-user-divider" />
              <button type="button" className="tt-user-item" onClick={signOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
