"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";
import { planLabel } from "@/lib/plan";
import LanguageToggle from "@/components/customer/LanguageToggle";
import NavDrawer from "./NavDrawer";
import { AccountIcon } from "@/components/ui/icons";
import RestaurantMark from "@/components/ui/RestaurantMark";

/**
 * Site-wide nav for logged-in restaurant users: brand top-left, user menu
 * top-right (profile / settings — coming soon — and sign out).
 */
export default function Navbar({
  restaurantName,
  restaurantLogo,
  restaurantLogoUrl,
  role,
  plan,
}: {
  restaurantName: string;
  restaurantLogo: string | null;
  restaurantLogoUrl?: string | null;
  /** Managers lose Settings/Staff; waiter/kitchen only get the orders board. */
  role: "owner" | "manager" | "waiter" | "cashier" | "kitchen" | "admin";
  /** Which tier the restaurant is on, for the badge in the account menu. */
  plan?: string | null;
}) {
  const t = useT();
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
            restaurantLogoUrl={restaurantLogoUrl}
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
            <span className="tt-navbar-logo">
              {/* The fork is the product's own mark: dashboard chrome should
                  not have a hole where a restaurant hasn't set anything. */}
              <RestaurantMark
                logoUrl={restaurantLogoUrl}
                emoji={restaurantLogo || "🍴"}
                name={restaurantName}
                size={26}
              />
            </span>
            <strong>{restaurantName}</strong>
          </Link>

          {/* The tier, beside the restaurant it belongs to and visible without
              opening anything. It was only in the account menu, which meant the
              answer to "what plan am I on?" was behind a click nobody thinks to
              make. Owner and manager only — the floor and the kitchen have no
              use for it. */}
          {plan && (role === "owner" || role === "manager") && (
            <span className="tt-plan-chip tt-navbar-plan">{planLabel(plan)}</span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LanguageToggle className="tt-lang-toggle-nav" />
          <div className="tt-user-menu" ref={menuRef}>
            <button
              type="button"
              className="tt-user-btn"
              aria-haspopup="true"
              aria-expanded={open}
              aria-label={t("nav.account")}
              onClick={() => setOpen(o => !o)}
            >
              <AccountIcon size={18} weight="bold" />
            </button>

            {open && (
              <div className="tt-user-dropdown" role="menu">
                {/* Which plan they are on, at the top of the menu they open to
                    find their account. Small on purpose — it answers a question
                    people ask often ("what am I paying for?") without taking
                    space from the things they came here to click. The owner can
                    tap through to change it; a manager only sees where they are,
                    because the plan is not theirs to change. */}
                {plan && (role === "owner" || role === "manager") &&
                  (role === "owner" ? (
                    <Link
                      href="/dashboard/plan"
                      role="menuitem"
                      className="tt-user-plan"
                      onClick={() => setOpen(false)}
                    >
                      <span className="tt-plan-chip">{planLabel(plan)}</span>
                      <span className="tt-muted">{t("nav.yourPlan")}</span>
                    </Link>
                  ) : (
                    <div className="tt-user-plan">
                      <span className="tt-plan-chip">{planLabel(plan)}</span>
                      <span className="tt-muted">{t("nav.yourPlan")}</span>
                    </div>
                  ))}
                <Link
                  href="/dashboard/profile"
                  role="menuitem"
                  className="tt-user-item"
                  onClick={() => setOpen(false)}
                >
                  {t("nav.profile")}
                </Link>
                {(role === "owner" || role === "manager") && (
                  <Link
                    href="/dashboard/settings"
                    role="menuitem"
                    className="tt-user-item"
                    onClick={() => setOpen(false)}
                  >
                    {t("nav.settings")}
                  </Link>
                )}
                <div className="tt-user-divider" />
                <button type="button" className="tt-user-item" onClick={signOut}>
                  {t("nav.signOut")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
