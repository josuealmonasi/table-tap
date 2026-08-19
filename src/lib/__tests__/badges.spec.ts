import { describe, expect, it } from "vitest";
import { badgeLabel, badgesFor } from "@/lib/badges";

const counts = { orders: 3, approvals: 2 };

describe("what a badge is allowed to claim", () => {
  it("shows an owner both the work and the decisions", () => {
    expect(badgesFor("owner", counts)).toEqual({
      "/dashboard/orders": 3,
      "/dashboard/bills": 2,
    });
  });

  it("does not ask a waiter to approve anything", () => {
    // A waiter cannot decide a request, so a count of them is a number they
    // can only ignore — and badges people ignore teach them to ignore all.
    expect(badgesFor("waiter", counts)).toEqual({ "/dashboard/orders": 3 });
  });

  it("gives the kitchen only its board", () => {
    expect(badgesFor("kitchen", counts)).toEqual({ "/dashboard/orders": 3 });
  });

  it("shows nothing when there is nothing to do", () => {
    expect(badgesFor("owner", { orders: 0, approvals: 0 })).toEqual({});
  });

  it("counts up to 99 and then stops being exact", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("+99");
    expect(badgeLabel(4821)).toBe("+99");
  });
});
