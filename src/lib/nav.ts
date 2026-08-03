export type NavItem = {
  href: string;
  emoji: string;
  /** i18n keys resolved with t() where the item is rendered. */
  titleKey: string;
  descKey: string;
  soon?: boolean;
};

/**
 * Secondary dashboard areas (shown as tiles and in the mobile drawer). Menus
 * are listed dynamically on the dashboard, so they're not part of this list.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard/orders", emoji: "🧾", titleKey: "nav.orders", descKey: "nav.ordersDesc" },
  {
    href: "/dashboard/analytics",
    emoji: "📊",
    titleKey: "nav.analytics",
    descKey: "nav.analyticsDesc",
  },
  {
    href: "/dashboard/promotions",
    emoji: "🎁",
    titleKey: "nav.promos",
    descKey: "nav.promosDesc",
  },
  { href: "/dashboard/tables", emoji: "🪑", titleKey: "nav.tables", descKey: "nav.tablesDesc" },
  { href: "/dashboard/staff", emoji: "👥", titleKey: "nav.staff", descKey: "nav.staffDesc" },
  {
    href: "/dashboard/settings",
    emoji: "⚙️",
    titleKey: "nav.settings",
    descKey: "nav.settingsDesc",
  },
];

export type DashboardRole = "owner" | "manager" | "waiter" | "kitchen" | "admin";

// Staff management stays with the owner; Settings is owner + manager
// (managers get the operational controls only — see SettingsForm).
const OWNER_ONLY = ["/dashboard/staff"];

/** The dashboard areas a role may see (drawer links and home tiles). */
export function navItemsFor(role: DashboardRole): NavItem[] {
  if (role === "admin") {
    return [
      {
        href: "/dashboard/admin",
        emoji: "🛡️",
        titleKey: "nav.admin",
        descKey: "nav.adminDesc",
      },
    ];
  }
  // Floor/back staff only get the live orders board.
  if (role === "kitchen" || role === "waiter") {
    return NAV_ITEMS.filter(i => i.href === "/dashboard/orders");
  }
  if (role === "manager") return NAV_ITEMS.filter(i => !OWNER_ONLY.includes(i.href));
  return NAV_ITEMS;
}
