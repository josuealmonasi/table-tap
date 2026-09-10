import { describe, expect, it } from "vitest";
import { badgeLabel, badgesFor } from "@/lib/badges";

/** Two on the stove, three under the lamp, two decisions waiting. */
const counts = { cooking: 2, ready: 3, approvals: 2 };

describe("what a badge is allowed to claim", () => {
  it("shows an owner both halves of the board and the decisions", () => {
    expect(badgesFor("owner", counts)).toEqual({
      "/dashboard/orders": 5,
      "/dashboard/bills": 2,
    });
  });

  it("counts a waiter only on the food waiting to be carried out", () => {
    // What is still cooking is the kitchen's; the waiter cannot hurry it, and
    // a number they can only ignore teaches them to ignore all of them. What
    // they CAN do is take out the three under the lamp.
    expect(badgesFor("waiter", counts)).toEqual({ "/dashboard/orders": 3 });
  });

  it("counts the kitchen only on what is still to cook", () => {
    // Their own finished plate is not outstanding work; it is done.
    expect(badgesFor("kitchen", counts)).toEqual({ "/dashboard/orders": 2 });
  });

  it("counts a cashier on what there is to hand over", () => {
    expect(badgesFor("cashier", counts)).toEqual({ "/dashboard/orders": 3 });
  });

  it("does not ask a waiter or a cashier to approve anything", () => {
    expect(badgesFor("waiter", counts)["/dashboard/bills"]).toBeUndefined();
    expect(badgesFor("cashier", counts)["/dashboard/bills"]).toBeUndefined();
  });

  it("leaves the kitchen alone when nothing is cooking", () => {
    expect(badgesFor("kitchen", { cooking: 0, ready: 4, approvals: 0 })).toEqual({});
  });

  it("leaves the floor alone when nothing is ready", () => {
    expect(badgesFor("waiter", { cooking: 6, ready: 0, approvals: 0 })).toEqual({});
  });

  it("shows nothing when there is nothing to do", () => {
    expect(badgesFor("owner", { cooking: 0, ready: 0, approvals: 0 })).toEqual({});
  });

  it("counts up to 99 and then stops being exact", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("+99");
    expect(badgeLabel(4821)).toBe("+99");
  });
});
