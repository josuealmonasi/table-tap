import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const rpc = vi.fn();
const update = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
const logEvent = vi.fn();
const actor = { restaurantId: "r1", email: "ana", role: "manager" };
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => actor }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/account-charge", () => ({ currencyOf: async () => "MXN" }));
vi.mock("@/lib/activity-log", () => ({ logEvent }));
vi.mock("@/lib/accounts-server", () => ({
  accountById: async () => ({ id: "a1", name: "Sam", credit_limit: 200 }),
  listAccounts: async () => [{ id: "a1", owed: 0 }], statementOf: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => ({ update }) }) }));
const { PATCH } = await import("@/app/api/accounts/route");
const patch = (body: object) => PATCH(new NextRequest("https://test/api/accounts", {
  method: "PATCH", body: JSON.stringify({ id: "a1", ...body }),
}));
beforeEach(() => { vi.clearAllMocks(); actor.role = "manager"; });
describe("account changes racing a new charge", () => {
  it("refuses a ceiling below debt that arrived after the account was read", async () => {
    rpc.mockResolvedValue({ data: { outcome: "limit", owed: 150 }, error: null });
    expect((await patch({ action: "limit", limit: 100 })).status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("account_change_v2", {
      p_restaurant: "r1", p_account: "a1", p_action: "limit", p_limit: 100, p_actor: "ana",
    });
    expect(update).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
  it("refuses closing when a charge won the account lock first", async () => {
    rpc.mockResolvedValue({ data: { outcome: "owes", owed: 100 }, error: null });
    expect((await patch({ action: "close" })).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
  it("logs a successful change using the locked previous ceiling", async () => {
    rpc.mockResolvedValue({ data: { outcome: "changed", previous_limit: 300 }, error: null });
    expect((await patch({ action: "limit", limit: 400 })).status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining("300.00") }));
  });
  it("keeps ceiling changes restricted to management", async () => {
    actor.role = "waiter";
    expect((await patch({ action: "limit", limit: 100 })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not report success when the transaction fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    expect((await patch({ action: "close" })).status).toBe(500);
    expect(logEvent).not.toHaveBeenCalled();
  });
});
