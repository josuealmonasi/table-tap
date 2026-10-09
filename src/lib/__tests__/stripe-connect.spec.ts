import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How a restaurant's Stripe account is made and when it may take cards.
 *
 * TableTap charges diners directly on the restaurant's account, so what the
 * account needs is the `merchant` configuration's `card_payments`. It used to
 * also ask for `recipient` — the destination-charge configuration — which
 * Stripe refused outright, and to wait for its transfers before offering cards.
 */
const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
let account: Record<string, unknown> = {};
const stored: Record<string, unknown> = { stripe_account_id: "acct_1", stripe_charges_enabled: false };

vi.mock("@/lib/stripe", () => ({
  stripe: {
    rawRequest: async (method: string, path: string, body: Record<string, unknown>) => {
      calls.push({ method, path, body });
      return path.startsWith("/v2/core/accounts") && method === "POST" ? { id: "acct_new" } : account;
    },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q = {
      select: () => q,
      eq: () => q,
      single: async () => ({ data: { ...stored }, error: null }),
      update: (patch: Record<string, unknown>) => (Object.assign(stored, patch), q),
    };
    return { from: () => q };
  },
}));

import { ensureConnectAccount, syncConnectStatus } from "@/lib/stripe-connect";

const withCardPayments = (status: string) => ({
  id: "acct_1",
  configuration: { merchant: { capabilities: { card_payments: { status } } } },
});

beforeEach(() => {
  calls.length = 0;
  Object.assign(stored, { stripe_account_id: "acct_1", stripe_charges_enabled: false });
});

describe("making a restaurant's Stripe account", () => {
  it("asks for card payments on the merchant configuration and nothing else", async () => {
    stored.stripe_account_id = null;
    expect(await ensureConnectAccount("r1", { currency: "MXN", email: "o@x.dev" })).toBe("acct_new");
    const made = calls.find(c => c.path === "/v2/core/accounts")!;
    expect(made.body.configuration).toEqual({ merchant: { capabilities: { card_payments: { requested: true } } } });
    expect(JSON.stringify(made.body)).not.toMatch(/recipient|stripe_transfers|payouts/);
  });
});

describe("when a restaurant may take cards", () => {
  it("takes cards once card_payments is active, with no transfers capability at all", async () => {
    account = withCardPayments("active");
    const s = await syncConnectStatus("r1");
    expect(s).toMatchObject({ chargesEnabled: true, detailsSubmitted: true });
    expect(stored.stripe_charges_enabled).toBe(true);
  });

  it("waits while Stripe reviews, and says the details are in", async () => {
    account = withCardPayments("pending");
    expect(await syncConnectStatus("r1")).toMatchObject({ chargesEnabled: false, detailsSubmitted: true });
  });

  it("offers nothing while onboarding is unfinished", async () => {
    account = withCardPayments("restricted");
    expect(await syncConnectStatus("r1")).toMatchObject({ chargesEnabled: false, detailsSubmitted: false });
    expect(stored.stripe_charges_enabled).toBe(false);
  });
});
