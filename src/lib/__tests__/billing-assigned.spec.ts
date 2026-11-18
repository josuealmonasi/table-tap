import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { assertStillAssigned } from "@/lib/billing-assigned";
import { safeLoginNext } from "@/lib/login-next";

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const dbWith = (row: Record<string, unknown> | null) => ({
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) }; return q; },
}) as never;
const assigned = (row: Record<string, unknown>) => ({ plan: "grupo", plan_status: "trialing", stripe_subscription_id: null, ...row });

describe("the emailed pay link opens Checkout only for its own assignment (review finding 1)", () => {
  const ends = inDays(5);
  const link = { plan: "grupo", until: ends.slice(0, 10) };

  it("passes for the unpaid assignment it was sent for", async () => {
    await expect(assertStillAssigned(dbWith(assigned({ trial_ends_at: ends })), "r1", link, 0)).resolves.toBeUndefined();
  });

  it("refuses once any subscription is live: it must not be moved and invoiced without a new confirmation", async () => {
    await expect(assertStillAssigned(dbWith(assigned({ trial_ends_at: ends })), "r1", link, 1)).rejects.toMatchObject({ key: "apiErr.tierLinkStale" });
  });

  it("refuses a replaced, expired or different assignment", async () => {
    for (const row of [
      assigned({ trial_ends_at: inDays(9) }),            // reassigned with another pay-by day
      assigned({ trial_ends_at: inDays(-1) }),           // expired
      assigned({ plan: "casa", trial_ends_at: ends }),   // another tier
      assigned({ plan_status: "active", trial_ends_at: ends }),
    ]) {
      await expect(assertStillAssigned(dbWith(row), "r1", { ...link, until: ends.slice(0, 10) }, 0)).rejects.toMatchObject({ key: "apiErr.tierLinkStale" });
    }
  });
});

describe("sign-in keeps only the pay link (review finding 6)", () => {
  it("accepts the exact pay-link shape and nothing else", () => {
    expect(safeLoginNext("/api/billing/assigned?plan=grupo&until=2026-11-24")).toBe("/api/billing/assigned?plan=grupo&until=2026-11-24");
    for (const bad of ["https://evil.example/", "//evil.example", "/dashboard", "/api/billing/assigned?plan=grupo",
      "/api/billing/assigned?plan=grupo&until=2026-11-24&x=1", null, 7]) {
      expect(safeLoginNext(bad)).toBeNull();
    }
  });
});
