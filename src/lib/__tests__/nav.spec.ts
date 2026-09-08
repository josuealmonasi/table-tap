import { describe, it, expect } from "vitest";
import { navItemsFor, type DashboardRole } from "@/lib/nav";

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

  it("the kitchen only gets the orders board", () => {
    expect(hrefs("kitchen")).toEqual(["/dashboard/orders"]);
  });

  it("a waiter also gets open bills — they can ask for a discount on one", () => {
    expect(hrefs("waiter")).toEqual(["/dashboard/orders", "/dashboard/bills"]);
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
    expect(withoutPos("cashier")).toEqual(["/dashboard/orders", "/dashboard/bills"]);
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
