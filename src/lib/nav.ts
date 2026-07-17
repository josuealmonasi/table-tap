export type NavItem = {
  href: string;
  emoji: string;
  title: string;
  desc: string;
  soon?: boolean;
};

/**
 * Secondary dashboard areas (shown as tiles and in the mobile drawer). Menus
 * are listed dynamically on the dashboard, so they're not part of this list.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard/orders",
    emoji: "🧾",
    title: "Orders",
    desc: "Live incoming orders",
  },
  {
    href: "/dashboard/analytics",
    emoji: "📊",
    title: "Analytics",
    desc: "Sales, top items and busy hours",
  },
  {
    href: "/dashboard/tables",
    emoji: "🪑",
    title: "Tables & QR",
    desc: "Manage tables and print QR codes",
  },
  {
    href: "/dashboard/staff",
    emoji: "👥",
    title: "Staff",
    desc: "Team logins and roles",
  },
  {
    href: "/dashboard/settings",
    emoji: "⚙️",
    title: "Settings",
    desc: "Restaurant name, currency and service charge",
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
        title: "Admin",
        desc: "All restaurants and users",
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
