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

  it("kitchen and waiter only get the orders board", () => {
    expect(hrefs("kitchen")).toEqual(["/dashboard/orders"]);
    expect(hrefs("waiter")).toEqual(["/dashboard/orders"]);
  });

  it("admin gets only the admin area", () => {
    expect(hrefs("admin")).toEqual(["/dashboard/admin"]);
  });
});
