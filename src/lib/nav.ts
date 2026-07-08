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
];
