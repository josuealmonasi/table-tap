import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { checkoutAssignment } from "@/lib/billing-assigned";
import { safeLoginNext } from "@/lib/login-next";

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const dbWith = (row: Record<string, unknown> | null) => ({
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) }; return q; },
}) as never;
const ID = "6f1c2c1e-1111-4111-8111-111111111111";
const assigned = (row: Record<string, unknown>) => ({ plan: "grupo", plan_status: "trialing", stripe_subscription_id: null, tier_assignment_id: ID, ...row });

describe("the emailed pay link opens Checkout only for its own assignment (review finding 1)", () => {
  const ends = inDays(5);

  it("passes for the unpaid assignment it was sent for", async () => {
    await expect(checkoutAssignment(dbWith(assigned({ trial_ends_at: ends })), "r1", "grupo", 0, ID))
      .resolves.toEqual({ id: ID, payBy: Math.floor(Date.parse(ends) / 1000) });
  });

  it("refuses once any subscription is live: it must not be moved and invoiced without a new confirmation", async () => {
    await expect(checkoutAssignment(dbWith(assigned({ trial_ends_at: ends })), "r1", "grupo", 1, ID))
      .rejects.toMatchObject({ key: "apiErr.tierLinkStale" });
  });

  it("refuses a replaced, expired or different assignment (findings 1 and 7)", async () => {
    for (const row of [
      // Replaced and recreated for the same tier and the same day: a new id.
      assigned({ trial_ends_at: ends, tier_assignment_id: "7a2d3d2f-2222-4222-8222-222222222222" }),
      assigned({ trial_ends_at: ends, tier_assignment_id: null }), // a free move cleared it
      assigned({ trial_ends_at: inDays(-1) }),           // expired
      assigned({ plan: "casa", trial_ends_at: ends }),   // another tier
      assigned({ plan_status: "active", trial_ends_at: ends }),
    ]) {
      await expect(checkoutAssignment(dbWith(row), "r1", "grupo", 0, ID)).rejects.toMatchObject({ key: "apiErr.tierLinkStale" });
    }
  });
});

describe("sign-in keeps only the pay link (review finding 6)", () => {
  it("accepts the exact pay-link shape and nothing else", () => {
    const link = `/api/billing/assigned?plan=grupo&a=${ID}`;
    expect(safeLoginNext(link)).toBe(link);
    for (const bad of ["https://evil.example/", "//evil.example", "/dashboard", "/api/billing/assigned?plan=grupo",
      `${link}&x=1`, "/api/billing/assigned?plan=grupo&a=not-an-id", null, 7]) {
      expect(safeLoginNext(bad)).toBeNull();
    }
  });
});
