import { describe, it, expect } from "vitest";
import { navItemsFor, type DashboardRole, NAV_FEATURES, NAV_ITEMS } from "@/lib/nav";

const hrefs = (role: DashboardRole) => navItemsFor(role).map(i => i.href);

describe("navItemsFor", () => {
  it("owner sees every area, including staff and settings", () => {
    expect(hrefs("owner")).toEqual(
      expect.arrayContaining(["/dashboard/staff", "/dashboard/settings"]),
    );
  });

  it("manager loses staff but keeps settings", () => {
    expect(hrefs("manager")).not.toContain("/dashboard/staff");
    expect(hrefs("manager")).toContain("/dashboard/settings");
  });

  it("the kitchen gets the orders board, and where it records waste", () => {
    expect(hrefs("kitchen")).toEqual(["/dashboard/orders", "/dashboard/waste"]);
  });

  it("gives waste to the team, and its costs to the owner and managers", () => {
    // The team records what it throws away; the owner and the managers read
    // it, with what it cost, on the costs screen — not a second nav entry.
    for (const role of ["kitchen", "waiter", "cashier"] as const) expect(hrefs(role)).toContain("/dashboard/waste");
    for (const role of ["owner", "manager"] as const) {
      expect(hrefs(role)).not.toContain("/dashboard/waste");
      expect(hrefs(role)).toContain("/dashboard/costs");
    }
    expect(navItemsFor("kitchen", f => f !== "costs").map(i => i.href)).toEqual(["/dashboard/orders"]);
  });

  it("a waiter gets the board, open bills, and their own order screen", () => {
    // Bills because they can ask for a discount on one; the order screen
    // because taking the order at the table is the waiter's whole job, and
    // until it existed they had to borrow a diner's phone to start one.
    // And customer accounts: a waiter puts a table's bill on one.
    expect(hrefs("waiter")).toEqual([
      "/dashboard/orders",
      "/dashboard/table-order",
      "/dashboard/waste",
      "/dashboard/bills",
      "/dashboard/accounts",
    ]);
  });

  it("admin gets only the admin area", () => {
    expect(hrefs("admin")).toEqual(["/dashboard/admin"]);
  });
});

describe("an area the tier does not include", () => {
  const withoutPos = (r: DashboardRole) =>
    navItemsFor(r, f => f !== "pos").map(i => i.href);

  it("gives the cashier the till on a tier that has it", () => {
    expect(hrefs("cashier")).toContain("/dashboard/pos");
  });

  it("takes the till away on a tier that does not", () => {
    // A link to a screen that turns you away is a promise the dashboard
    // should not make — the screen refuses too, but not by being reachable.
    expect(withoutPos("cashier")).not.toContain("/dashboard/pos");
    expect(withoutPos("owner")).not.toContain("/dashboard/pos");
  });

  it("leaves the cashier their other screens", () => {
    // Customer accounts stay on every tier: one opened on a paid plan still
    // owes after a move down, and its page collects it (opening is locked).
    // Held money also needs an upload surface after the till is locked.
    expect(withoutPos("cashier")).toEqual(["/dashboard/orders", "/dashboard/waste", "/dashboard/held-sales", "/dashboard/bills", "/dashboard/accounts"]);
  });

  it("never offers the till to a waiter or the kitchen", () => {
    // Carrying a card machine to a table is settling somebody else's bill,
    // which is a different job from ringing a sale.
    expect(hrefs("waiter")).not.toContain("/dashboard/pos");
    expect(hrefs("kitchen")).not.toContain("/dashboard/pos");
  });

  it("gives it to an owner and a manager, who work every station", () => {
    expect(hrefs("owner")).toContain("/dashboard/pos");
    expect(hrefs("manager")).toContain("/dashboard/pos");
  });
});

/**
 * The features the nav gates on are read off the nav, not listed beside it.
 *
 * The root layout used to build that list by hand — it named "pos" and nothing
 * else — so the next tiered area added to the nav was filtered straight back
 * out of it by a line that had no idea the area existed. The link simply never
 * appeared, on a plan that included it, and nothing failed.
 */
describe("the features the nav gates on", () => {
  it("names every feature any nav item asks for", () => {
    const asked = [...new Set(NAV_ITEMS.map(i => i.feature).filter(Boolean))];
    expect([...NAV_FEATURES].sort()).toEqual([...asked].sort());
  });

  it("is not empty, or every tiered area would vanish", () => {
    expect(NAV_FEATURES.length).toBeGreaterThan(1);
  });
});
