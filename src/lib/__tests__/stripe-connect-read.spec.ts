import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

interface Answer { data: Record<string, unknown> | null; error: { message: string } | null }
const reads: Answer[] = [];
const rawRequest = vi.fn();
let stored: string | null = null;
let winner: string | null = null;
let writeError: { message: string } | null = null;
let writes = 0;
let skipWrite = false;
vi.mock("@/lib/stripe", () => ({ stripe: { rawRequest: (...args: unknown[]) => rawRequest(...args) } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => {
    let patch: { stripe_account_id: string } | undefined;
    let onlyEmpty = false;
    let returning = false;
    const q = {
      select: () => { returning = true; return q; },
      eq: () => q,
      is: (column: string, value: unknown) => { onlyEmpty = column === "stripe_account_id" && value === null; return q; },
      single: async () => reads.shift() ?? { data: { stripe_account_id: stored }, error: null },
      update: (value: { stripe_account_id: string }) => { patch = value; return q; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        writes++;
        // Another request saves its account after our read, before our update.
        if (winner) stored = winner;
        const changed = !writeError && !skipWrite && (!onlyEmpty || stored === null);
        if (changed && patch) stored = patch.stripe_account_id;
        return Promise.resolve({ data: returning ? (changed ? [{ stripe_account_id: stored }] : []) : null, error: writeError }).then(resolve, reject);
      },
    };
    return q;
  } }),
}));
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r1", email: "owner@example.com" }) }));
vi.mock("@/lib/membership", () => ({ getMembership: async () => ({ restaurant: { currency: "MXN" } }) }));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: () => "https://tabletap.test" }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => Response.json({ error: key }, { status }) }));

import { ensureConnectAccount, syncConnectStatus } from "@/lib/stripe-connect";
import { POST } from "@/app/api/connect/onboard/route";
import { GET } from "@/app/api/connect/status/route";

beforeEach(() => {
  reads.length = 0;
  rawRequest.mockReset().mockResolvedValue({ id: "acct_new", url: "https://stripe.test/onboard" });
  stored = null;
  winner = null;
  writeError = null;
  writes = 0;
  skipWrite = false;
});

describe("a restaurant's saved Connect account", () => {
  it("a failed read never creates an account", async () => {
    stored = "acct_original";
    reads.push({ data: null, error: { message: "connection reset" } });
    await expect(ensureConnectAccount("r1", { currency: "MXN" })).rejects.toThrow(/connection reset/);
    expect(rawRequest).not.toHaveBeenCalled();
    expect(writes).toBe(0);
    expect(stored).toBe("acct_original");
  });

  it("returns a concurrent winner's id without overwriting it", async () => {
    winner = "acct_winner";
    expect(await ensureConnectAccount("r1", { currency: "MXN" })).toBe("acct_winner");
    expect(stored).toBe("acct_winner");
    expect(rawRequest).toHaveBeenCalledTimes(1);
  });

  it("does not return an account whose save failed", async () => {
    writeError = { message: "write unavailable" };
    await expect(ensureConnectAccount("r1", { currency: "MXN" })).rejects.toThrow(/write unavailable/);
    expect(stored).toBeNull();
  });

  it("fails if the winning account cannot be read", async () => {
    winner = "acct_winner";
    reads.push({ data: { stripe_account_id: null }, error: null }, { data: null, error: { message: "winner read failed" } });
    await expect(ensureConnectAccount("r1", { currency: "MXN" })).rejects.toThrow(/winner read failed/);
    expect(stored).toBe("acct_winner");
  });

  it("does not offer the orphan if no row saved an account", async () => {
    skipWrite = true;
    await expect(ensureConnectAccount("r1", { currency: "MXN" })).rejects.toThrow(/not saved/);
    expect(stored).toBeNull();
  });

  it("reuses an existing account without creating or saving another", async () => {
    stored = "acct_existing";
    expect(await ensureConnectAccount("r1", { currency: "USD" })).toBe(stored);
    expect(rawRequest).not.toHaveBeenCalled();
    expect(writes).toBe(0);
  });

  it("saves a first account and returns its id", async () => {
    expect(await ensureConnectAccount("r1", { currency: "MXN" })).toBe("acct_new");
    expect(stored).toBe("acct_new");
  });

  it("a failed status read throws before consulting Stripe", async () => {
    reads.push({ data: null, error: { message: "status unavailable" } });
    await expect(syncConnectStatus("r1")).rejects.toThrow(/status unavailable/);
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it("onboarding returns its existing error copy on a failed read", async () => {
    reads.push({ data: null, error: { message: "onboard unavailable" } });
    const response = await POST(new NextRequest("https://tabletap.test/api/connect/onboard", { method: "POST" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "apiErr.stripeOnboard" });
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it("status returns an error rather than disconnected on a failed read", async () => {
    reads.push({ data: null, error: { message: "status unavailable" } });
    const response = await GET();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "apiErr.generic" });
  });
});
