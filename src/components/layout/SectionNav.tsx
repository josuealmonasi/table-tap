"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItemsFor, type DashboardRole } from "@/lib/nav";
import { useT } from "@/lib/i18n/context";
import { NAV_ICONS } from "@/components/ui/icons";

/** Configuration, not daily work — these stay in the account menu. */
const SETTINGS_AREAS = ["/dashboard/staff", "/dashboard/plan", "/dashboard/settings"];

/**
 * The sections of the dashboard, always in reach.
 *
 * Getting from Ajustes to Pedidos meant going back through the home grid,
 * because the grid was the only road between sections. Navigation you have to
 * navigate to is not navigation.
 *
 * What is here is what somebody touches during service. Staff logins, the
 * subscription and the restaurant's settings are configured once and then left
 * alone, so they stay in the account menu — putting them in the same row as
 * Pedidos would make the row longer without making anything easier to reach.
 *
 * Roles are honoured by reading the same `navItemsFor` the home tiles use, so
 * a waiter cannot be shown a door they will be turned away from.
 */
export default function SectionNav({ role }: { role: DashboardRole }) {
  const t = useT();
  const pathname = usePathname();
  // The navbar lives in the root layout, which also wraps the diner's menu —
  // the same trap TermsGate fell into. Dashboard only.
  if (!pathname.startsWith("/dashboard")) return null;

  const items = navItemsFor(role).filter(i => !SETTINGS_AREAS.includes(i.href));

  // One section is not a choice; the kitchen has only its board.
  if (items.length < 2) return null;

  return (
    <nav className="tt-section-nav" aria-label={t("nav.sections")}>
      <div className="container tt-section-nav-inner">
        {items.map(item => {
          const Icon = NAV_ICONS[item.icon];
          // Exact match, or a child page of it — /dashboard/menu/123 is still
          // the menu section.
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`tt-section-link ${active ? "tt-section-link-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={18} weight={active ? "fill" : "regular"} />
              {/* Both are rendered and CSS picks one, so the phone gets the
                  short noun and the desktop row keeps the full name. */}
              <span className="tt-section-label">{t(item.titleKey)}</span>
              {item.shortKey && (
                <span className="tt-section-label-short">{t(item.shortKey)}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
