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
let writeFails = false;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const where: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => ((where[k] = v), q),
      single: async () => ({ data: { ...stored }, error: null }),
      // The restaurant whose account it is, looked up by the account id.
      maybeSingle: async () => ({ data: where.stripe_account_id === stored.stripe_account_id ? { id: "r1" } : null, error: null }),
      update: (patch: Record<string, unknown>) => {
        if (writeFails) return { eq: async () => ({ error: { message: "connection reset" } }) };
        Object.assign(stored, patch);
        return { eq: async () => ({ error: null }) };
      },
    };
    return { from: () => q };
  },
}));

import { ensureConnectAccount, syncConnectAccount, syncConnectStatus } from "@/lib/stripe-connect";

const withCardPayments = (status: string) => ({
  id: "acct_1",
  configuration: { merchant: { capabilities: { card_payments: { status } } } },
});

beforeEach(() => {
  calls.length = 0;
  writeFails = false;
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

describe("when Stripe says a restaurant's account changed", () => {
  it("stores what Stripe says now: cards on once it finished reviewing, off once it restricted them", async () => {
    account = withCardPayments("active");
    expect(await syncConnectAccount("acct_1")).toBe(true);
    expect(stored.stripe_charges_enabled).toBe(true);
    account = withCardPayments("inactive");
    await syncConnectAccount("acct_1");
    expect(stored.stripe_charges_enabled).toBe(false);
    // Read from Stripe itself, not from the event, so an old event cannot store an old answer.
    expect(calls.filter(c => c.method === "GET").map(c => c.path)).toEqual([
      "/v2/core/accounts/acct_1?include=configuration.merchant",
      "/v2/core/accounts/acct_1?include=configuration.merchant",
    ]);
  });

  it("leaves alone an account no restaurant here has", async () => {
    expect(await syncConnectAccount("acct_somebody_else")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("fails out loud when the answer cannot be stored, so Stripe sends the event again", async () => {
    account = withCardPayments("active");
    writeFails = true;
    await expect(syncConnectAccount("acct_1")).rejects.toThrow(/connect status write failed/);
  });
});
