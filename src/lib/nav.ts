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
  { href: "/dashboard/orders", emoji: "🧾", title: "Orders", desc: "Live incoming orders" },
  { href: "/dashboard/tables", emoji: "🪑", title: "Tables & QR", desc: "Manage tables and print QR codes" },
  { href: "/dashboard/staff", emoji: "👥", title: "Staff", desc: "Team logins and roles" },
  { href: "/dashboard/settings", emoji: "⚙️", title: "Settings", desc: "Restaurant name, currency and service charge" },
];

export type DashboardRole = "owner" | "manager" | "kitchen";

// Staff management and settings stay with the owner.
const OWNER_ONLY = ["/dashboard/staff", "/dashboard/settings"];

/** The dashboard areas a role may see (drawer links and home tiles). */
export function navItemsFor(role: DashboardRole): NavItem[] {
  if (role === "kitchen") return NAV_ITEMS.filter((i) => i.href === "/dashboard/orders");
  if (role === "manager") return NAV_ITEMS.filter((i) => !OWNER_ONLY.includes(i.href));
  return NAV_ITEMS;
}
