import type { PlanFeature } from "@/lib/plan";

export type NavItem = {
  href: string;
  /** Present when a tier decides whether this area exists at all. */
  feature?: PlanFeature;
  /**
   * Key into the shared icon set (src/components/ui/icons.tsx). A key rather
   * than a component, because this module is plain data — importing React
   * components here would drag the icon bundle into anything that reads the
   * nav, including the server.
   */
  icon:
    | "Orders"
    | "Analytics"
    | "Costs"
    | "Waste"
    | "Promotions"
    | "Loyalty"
    | "Table"
    | "TakeOrder"
    | "Till"
    | "HeldSales"
    | "Bills"
    | "Accounts"
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
  // In the order they are used (owner's call, 2026-10-28, made whole on
  // 2026-11-10): the menus, the floor's live screens, what collects the
  // money, what brings people back, then the setup screens, and the books —
  // Costos and Analíticas — last of all. The tab row leaves out staff,
  // settings and plan (they live in the account menu); the drawer and the
  // home tiles show them in this same order.
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
    // Caja is the register on its own: a sale is served where it is paid, and
    // there is no board for it to wait on.
    feature: "kitchenBoard",
  },
  {
    // The counter till. Only on the tiers that include it — the screen itself
    // refuses too, but a link to a screen that turns you away is a promise the
    // dashboard should not make.
    href: "/dashboard/pos",
    icon: "Till",
    titleKey: "nav.pos",
    descKey: "nav.posDesc",
    feature: "pos",
  },
  {
    // The waiter's own screen: a table is seated, and the person standing at it
    // writes down what they want. Tiered, like the till — and the screen itself
    // refuses too, because a link to a screen that turns you away is a promise
    // the dashboard should not make.
    href: "/dashboard/table-order",
    icon: "TakeOrder",
    titleKey: "nav.tableOrder",
    descKey: "nav.tableOrderDesc",
    feature: "waiterService",
  },
  {
    href: "/dashboard/bills",
    icon: "Bills",
    titleKey: "nav.bills",
    shortKey: "nav.billsShort",
    descKey: "nav.billsDesc",
  },
  {
    href: "/dashboard/held-sales",
    icon: "HeldSales",
    titleKey: "recovery.title",
    shortKey: "recovery.short",
    descKey: "recovery.deviceOnly",
  },
  {
    // Not gated on the plan: an account opened on a paid tier still owes
    // after a move down, and its page — with the lock on opening new ones —
    // is where it is collected.
    href: "/dashboard/accounts",
    icon: "Accounts",
    titleKey: "nav.accounts",
    shortKey: "nav.accountsShort",
    descKey: "nav.accountsDesc",
  },
  {
    href: "/dashboard/promotions",
    icon: "Promotions",
    titleKey: "nav.promos",
    shortKey: "nav.promosShort",
    descKey: "nav.promosDesc",
  },
  {
    // The visit card: the program, and every card and who stamped it. Only
    // on the tiers that include it, like the till.
    href: "/dashboard/loyalty",
    icon: "Loyalty",
    titleKey: "nav.loyalty",
    descKey: "nav.loyaltyDesc",
    feature: "loyalty",
  },
  {
    href: "/dashboard/tables",
    icon: "Table",
    titleKey: "nav.tables",
    shortKey: "nav.tablesShort",
    descKey: "nav.tablesDesc",
  },
  {
    // What was thrown away, recorded by whoever threw it. The team's screen:
    // the owner and the managers read it, with what it cost, on Costos.
    href: "/dashboard/waste",
    icon: "Waste",
    titleKey: "nav.waste",
    descKey: "nav.wasteDesc",
    feature: "costs",
  },
  {
    href: "/dashboard/staff",
    icon: "Staff",
    titleKey: "nav.staff",
    descKey: "nav.staffDesc",
  },
  {
    href: "/dashboard/settings",
    icon: "Settings",
    titleKey: "nav.settings",
    descKey: "nav.settingsDesc",
  },
  {
    href: "/dashboard/plan",
    icon: "Plan",
    titleKey: "nav.plan",
    descKey: "nav.planDesc",
  },
  {
    // What each product leaves: ingredients, recipes, the fee for taking the
    // money. The restaurant's private books, so owner and manager only, and
    // only on the tiers that carry it.
    href: "/dashboard/costs",
    icon: "Costs",
    titleKey: "nav.costs",
    descKey: "nav.costsDesc",
    feature: "costs",
  },
  {
    href: "/dashboard/analytics",
    icon: "Analytics",
    titleKey: "nav.analytics",
    descKey: "nav.analyticsDesc",
  },
];

export type DashboardRole =
  | "owner"
  | "manager"
  | "waiter"
  | "cashier"
  | "kitchen"
  | "admin";

// Staff management stays with the owner; Settings is owner + manager
// (managers get the operational controls only — see SettingsForm).
// Staff logins and the subscription are both the owner's alone: a manager runs
// the restaurant, but hiring and the card are not theirs to change.
const OWNER_ONLY = ["/dashboard/staff", "/dashboard/plan"];
// The team's own screens, which owners and managers reach from their own:
// waste is recorded here and read, with its cost, on the costs screen.
const TEAM_ONLY = ["/dashboard/waste"];

/**
 * The dashboard areas a role may see (drawer links and home tiles).
 *
 * `includes` answers whether the restaurant's tier carries a feature. It
 * defaults to yes, so a caller with no plan to hand — the loading skeleton —
 * still counts the same rows. A caller that knows the plan passes it, and an
 * area the tier does not include never appears: a link to a screen that turns
 * you away is a promise the dashboard should not make.
 */
/**
 * Every feature the navigation gates an area on.
 *
 * Read off the items themselves, so adding a tiered area to the nav is one
 * edit rather than two — the second of which used to be a hardcoded list in
 * the root layout that named "pos" and nothing else.
 */
export const NAV_FEATURES: PlanFeature[] = [
  ...new Set(NAV_ITEMS.map(i => i.feature).filter((f): f is PlanFeature => Boolean(f))),
];

export function navItemsFor(
  role: DashboardRole,
  includes: (feature: PlanFeature) => boolean = () => true,
): NavItem[] {
  const allowed = (items: NavItem[]): NavItem[] =>
    items.filter(i => !i.feature || includes(i.feature));
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
  // The kitchen only gets its board. Waiter and cashier also get open bills:
  // one asks for a discount on a table, the other collects at the till, and
  // both need the same screen to do it.
  if (role === "kitchen") {
    return allowed(NAV_ITEMS.filter(i => ["/dashboard/orders", "/dashboard/waste"].includes(i.href)));
  }
  // The till is the cashier's own screen; a waiter carries a card machine to a
  // table, which is a different job and a different screen.
  if (role === "cashier") {
    return allowed(
      NAV_ITEMS.filter(i =>
        ["/dashboard/orders", "/dashboard/bills", "/dashboard/pos", "/dashboard/accounts", "/dashboard/waste", "/dashboard/held-sales"].includes(i.href),
      ).map(i => i.href === "/dashboard/held-sales" ? { ...i, descKey: "recovery.uploadOnly" } : i),
    );
  }
  if (role === "waiter") {
    return allowed(
      NAV_ITEMS.filter(i =>
        ["/dashboard/orders", "/dashboard/bills", "/dashboard/table-order", "/dashboard/accounts", "/dashboard/waste"].includes(i.href),
      ),
    );
  }
  if (role === "manager") return allowed(NAV_ITEMS.filter(i => !OWNER_ONLY.includes(i.href) && !TEAM_ONLY.includes(i.href)));
  return allowed(NAV_ITEMS.filter(i => !TEAM_ONLY.includes(i.href)));
}

/**
 * Every fixed page under /dashboard. Anything else there is a menu's own page
 * (`[menu]`), which belongs to the Menús tab. Kept equal to the folders in
 * `src/app/dashboard` by a test: a fixed page missing here lit Menús on
 * Ajustes, Perfil and every other page that has no tab of its own.
 */
export const DASHBOARD_PAGES = [
  "accounts", "admin", "analytics", "bills", "costs", "held-sales", "loyalty", "orders", "plan", "pos",
  "profile", "promotions", "settings", "staff", "table-order", "tables", "waste",
];

/** The tab a path belongs to: the longest matching tab, a menu's page to Menús, a page without a tab to none. */
export function currentSection(pathname: string, hrefs: string[]): string | undefined {
  const match = hrefs
    .filter(href => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (match !== "/dashboard" || pathname === "/dashboard") return match;
  const page = pathname.slice("/dashboard/".length).split("/")[0];
  return DASHBOARD_PAGES.includes(page) ? undefined : match;
}
