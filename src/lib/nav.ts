export type NavItem = {
  href: string;
  /**
   * Key into the shared icon set (src/components/ui/icons.tsx). A key rather
   * than a component, because this module is plain data — importing React
   * components here would drag the icon bundle into anything that reads the
   * nav, including the server.
   */
  icon:
    | "Orders"
    | "Analytics"
    | "Promotions"
    | "Table"
    | "Bills"
    | "Staff"
    | "Menu"
    | "Settings"
    | "Plan"
    | "PlatformAdmin";
  /** i18n keys resolved with t() where the item is rendered. */
  titleKey: string;
  /**
   * A shorter name, for the phone's tab bar. "Cuentas abiertas" across five
   * tabs on a 360px screen leaves the labels touching; a tab bar wants one
   * noun. Absent means the full name already is one.
   */
  shortKey?: string;
  descKey: string;
  soon?: boolean;
};

/**
 * Secondary dashboard areas (shown as tiles and in the mobile drawer). Menus
 * are listed dynamically on the dashboard, so they're not part of this list.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    // The dashboard home *is* the menus screen — the card at the top of it is
    // the list, and each menu opens from there. Naming it for what it holds
    // beats a "Panel" link that says nothing about what you would find.
    href: "/dashboard",
    icon: "Menu",
    titleKey: "nav.menus",
    descKey: "nav.menusDesc",
  },
  {
    href: "/dashboard/orders",
    icon: "Orders",
    titleKey: "nav.orders",
    descKey: "nav.ordersDesc",
  },
  {
    href: "/dashboard/analytics",
    icon: "Analytics",
    titleKey: "nav.analytics",
    descKey: "nav.analyticsDesc",
  },
  {
    href: "/dashboard/promotions",
    icon: "Promotions",
    titleKey: "nav.promos",
    shortKey: "nav.promosShort",
    descKey: "nav.promosDesc",
  },
  {
    href: "/dashboard/bills",
    icon: "Bills",
    titleKey: "nav.bills",
    shortKey: "nav.billsShort",
    descKey: "nav.billsDesc",
  },
  {
    href: "/dashboard/tables",
    icon: "Table",
    titleKey: "nav.tables",
    shortKey: "nav.tablesShort",
    descKey: "nav.tablesDesc",
  },
  {
    href: "/dashboard/staff",
    icon: "Staff",
    titleKey: "nav.staff",
    descKey: "nav.staffDesc",
  },
  {
    href: "/dashboard/plan",
    icon: "Plan",
    titleKey: "nav.plan",
    descKey: "nav.planDesc",
  },
  {
    href: "/dashboard/settings",
    icon: "Settings",
    titleKey: "nav.settings",
    descKey: "nav.settingsDesc",
  },
];

export type DashboardRole = "owner" | "manager" | "waiter" | "kitchen" | "admin";

// Staff management stays with the owner; Settings is owner + manager
// (managers get the operational controls only — see SettingsForm).
// Staff logins and the subscription are both the owner's alone: a manager runs
// the restaurant, but hiring and the card are not theirs to change.
const OWNER_ONLY = ["/dashboard/staff", "/dashboard/plan"];

/** The dashboard areas a role may see (drawer links and home tiles). */
export function navItemsFor(role: DashboardRole): NavItem[] {
  if (role === "admin") {
    return [
      {
        href: "/dashboard/admin",
        icon: "PlatformAdmin",
        titleKey: "nav.admin",
        descKey: "nav.adminDesc",
      },
    ];
  }
  // The kitchen only gets its board. A waiter also gets open bills: they can
  // ask for a discount on one, even though only a manager grants it.
  if (role === "kitchen") return NAV_ITEMS.filter(i => i.href === "/dashboard/orders");
  if (role === "waiter") {
    return NAV_ITEMS.filter(
      i => i.href === "/dashboard/orders" || i.href === "/dashboard/bills",
    );
  }
  if (role === "manager") return NAV_ITEMS.filter(i => !OWNER_ONLY.includes(i.href));
  return NAV_ITEMS;
}
