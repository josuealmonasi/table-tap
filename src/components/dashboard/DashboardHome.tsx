"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Menu, Restaurant } from "@/lib/types";
import { useMenuEditor } from "@/hooks/useMenuEditor";
import { navItemsFor, type DashboardRole } from "@/lib/nav";
import { menuSlug } from "@/lib/slug";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SetupChecklist from "./SetupChecklist";
import type { SetupStep } from "@/lib/setup-steps";
import { Skeleton } from "@/components/ui/Skeleton";
import MenusPanel from "@/components/dashboard/menu/MenusPanel";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { NAV_ICONS } from "@/components/ui/icons";
import { useRowMemory } from "@/hooks/useRowMemory";
import type { ScheduleAccess } from "@/lib/menu-schedule";

interface DashboardHomeProps {
  restaurant: Restaurant;
  /** Filters the area tiles — managers don't see Staff or Settings. */
  role: DashboardRole;
  /** Whether this tier carries menu schedules (decided on the server). */
  schedules: ScheduleAccess;
  /** What is left to set up — the owner's; empty for anybody else. */
  setup?: SetupStep[];
}

/** Restaurant dashboard landing — the restaurant's menus, plus other areas. */
export default function DashboardHome({ restaurant, role, schedules, setup = [] }: DashboardHomeProps) {
  const t = useT();
  const editor = useMenuEditor(restaurant.id);
  const menuRows = useRowMemory(
    "menus",
    2,
    editor.loading ? undefined : editor.menus.length,
  );
  const router = useRouter();

  const openMenu = (menu: Menu) => router.push(`/dashboard/${menuSlug(menu.name)}`);

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "nav.dashboard" }]} />
        </header>

        {!restaurant.accepting_orders && (
          <div
            className="tt-closed-banner"
            style={{ marginTop: 0, marginBottom: 16 }}
            role="status"
          >
            {t("dash.ordersPausedBanner")}{" "}
            <Link href="/dashboard/settings" style={{ fontWeight: 600 }}>
              {t("dash.resumeInSettings")}
            </Link>
          </div>
        )}

        <SetupChecklist steps={setup} />

        {editor.loadFailed && <div className="tt-section" role="alert">
          <p>{t("menu.reloadFailed")}</p>
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={editor.reload}>{t("fallback.retry")}</button>
        </div>}
        <fieldset disabled={editor.loadFailed} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        {editor.loading ? (
          <div
            className="tt-section"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <Skeleton width={120} height={18} />
            {Array.from({ length: menuRows }).map((_, i) => (
              <Skeleton key={i} width="100%" height={44} radius={12} />
            ))}
          </div>
        ) : !editor.hasLoaded ? null : (
          <MenusPanel
            menus={editor.menus}
            onOpen={openMenu}
            onAdd={editor.addMenu}
            onRename={editor.renameMenu}
            onSetSchedule={editor.setMenuSchedule}
            timeZone={restaurant.timezone ?? DEFAULT_TIME_ZONE}
            schedules={schedules}
            onDelete={editor.deleteMenu}
            onToggleActive={editor.setMenuActive}
            onDuplicate={editor.duplicateMenu}
            onMove={editor.moveMenu}
          />
        )}

        </fieldset>
        <div className="tt-tiles">
          {/* Not a tile linking to the page you are standing on: the menus
              live in the card above, and the nav bar names this screen. */}
          {navItemsFor(role)
            .filter(tile => tile.href !== "/dashboard")
            .map(tile => {
              const Glyph = NAV_ICONS[tile.icon];
              return tile.soon ? (
                <div key={tile.href} className="tt-tile tt-tile-soon">
                  <Glyph size={26} className="tt-tile-emoji" />
                  <strong>{t(tile.titleKey)}</strong>
                  <span className="tt-muted">{t(tile.descKey)}</span>
                  <span className="tt-badge" style={{ marginTop: 8 }}>
                    {t("dash.comingSoon")}
                  </span>
                </div>
              ) : (
                <Link key={tile.href} href={tile.href} className="tt-tile">
                  <Glyph size={26} className="tt-tile-emoji" />
                  <strong>{t(tile.titleKey)}</strong>
                  <span className="tt-muted">{t(tile.descKey)}</span>
                </Link>
              );
            })}
        </div>
      </div>
    </div>
  );
}
