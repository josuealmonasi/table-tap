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
