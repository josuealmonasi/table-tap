"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Menu, Restaurant } from "@/lib/types";
import { useMenuEditor } from "@/hooks/useMenuEditor";
import { navItemsFor, type DashboardRole } from "@/lib/nav";
import { menuSlug } from "@/lib/slug";
import Breadcrumb from "@/components/layout/Breadcrumb";
import { Skeleton } from "@/components/ui/Skeleton";
import MenusPanel from "@/components/dashboard/menu/MenusPanel";

interface DashboardHomeProps {
  restaurant: Restaurant;
  /** Filters the area tiles — managers don't see Staff or Settings. */
  role: DashboardRole;
}

/** Restaurant dashboard landing — the restaurant's menus, plus other areas. */
export default function DashboardHome({ restaurant, role }: DashboardHomeProps) {
  const editor = useMenuEditor(restaurant.id);
  const router = useRouter();

  const openMenu = (menu: Menu) => router.push(`/dashboard/${menuSlug(menu.name)}`);

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Dashboard" }]} />
        </header>

        {!restaurant.accepting_orders && (
          <div
            className="tt-closed-banner"
            style={{ marginTop: 0, marginBottom: 16 }}
            role="status"
          >
            ⏸️ Orders are paused — customers can browse but can&apos;t order.{" "}
            <Link href="/dashboard/settings" style={{ fontWeight: 600 }}>
              Resume in Settings
            </Link>
          </div>
        )}

        {editor.loading ? (
          <div
            className="tt-section"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <Skeleton width={120} height={18} />
            <Skeleton width="100%" height={44} radius={12} />
            <Skeleton width="100%" height={44} radius={12} />
          </div>
        ) : (
          <MenusPanel
            menus={editor.menus}
            onOpen={openMenu}
            onAdd={editor.addMenu}
            onRename={editor.renameMenu}
            onDelete={editor.deleteMenu}
            onToggleActive={editor.setMenuActive}
            onDuplicate={editor.duplicateMenu}
            onMove={editor.moveMenu}
          />
        )}

        <div className="tt-tiles" style={{ marginTop: 16 }}>
          {navItemsFor(role).map(tile =>
            tile.soon ? (
              <div key={tile.title} className="tt-tile tt-tile-soon">
                <div className="tt-tile-emoji">{tile.emoji}</div>
                <strong>{tile.title}</strong>
                <span className="tt-muted">{tile.desc}</span>
                <span className="tt-badge" style={{ marginTop: 8 }}>
                  Coming soon
                </span>
              </div>
            ) : (
              <Link key={tile.title} href={tile.href} className="tt-tile">
                <div className="tt-tile-emoji">{tile.emoji}</div>
                <strong>{tile.title}</strong>
                <span className="tt-muted">{tile.desc}</span>
              </Link>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
