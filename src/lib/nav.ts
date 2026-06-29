export type NavItem = {
  href: string;
  emoji: string;
  title: string;
  desc: string;
  soon?: boolean;
};

/** Primary dashboard navigation — shared by the dashboard tiles and the mobile drawer. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard/menu", emoji: "📋", title: "Menu", desc: "Add sections, products, extras and prices" },
  { href: "#", emoji: "🧾", title: "Orders", desc: "Live incoming orders", soon: true },
  { href: "#", emoji: "🪑", title: "Tables & QR", desc: "Manage tables and print QR codes", soon: true },
];
