import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const rpc = vi.fn();
const update = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
const logEvent = vi.fn();
const accountLookup = vi.fn();
const statementRead = vi.fn();
const timezoneRead = vi.fn();
const timezoneScope = vi.fn().mockReturnThis();
const from = vi.fn(() => ({ update, select: vi.fn().mockReturnThis(), eq: timezoneScope, maybeSingle: timezoneRead }));
let authorized = true;
const actor = { restaurantId: "r1", email: "ana", role: "manager" };
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => authorized ? actor : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/account-charge", () => ({ currencyOf: async () => "MXN" }));
vi.mock("@/lib/activity-log", () => ({ logEvent }));
vi.mock("@/lib/accounts-server", () => ({
  accountById: (...args: unknown[]) => accountLookup(...args),
  listAccounts: async () => [{ id: "a1", owed: 0 }], statementOf: (...args: unknown[]) => statementRead(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
const { GET, PATCH } = await import("@/app/api/accounts/route");
const patch = (body: object) => PATCH(new NextRequest("https://test/api/accounts", {
  method: "PATCH", body: JSON.stringify({ id: "a1", ...body }),
}));
beforeEach(() => {
  vi.clearAllMocks(); actor.role = "manager"; authorized = true;
  accountLookup.mockReset().mockResolvedValue({ id: "a1", name: "Sam", credit_limit: 200, restaurant_id: "r1" });
  statementRead.mockReset(); timezoneRead.mockReset();
});
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

it("authorizes the account before starting statement and timezone together", async () => {
  const req = () => new NextRequest("https://test/api/accounts?id=a1&restaurantId=other");
  authorized = false;
  const denied = await GET(req());
  const deniedReads = { accounts: accountLookup.mock.calls.length, timezone: from.mock.calls.length, statement: statementRead.mock.calls.length };
  authorized = true;
  accountLookup.mockResolvedValueOnce(null);
  const missing = await GET(req());
  const missingReads = { timezone: from.mock.calls.length, statement: statementRead.mock.calls.length };
  let releaseAccount!: (value: object) => void;
  accountLookup.mockReturnValueOnce(new Promise(resolve => { releaseAccount = resolve; }));
  let releaseTimezone!: (value: object) => void;
  timezoneRead.mockReturnValueOnce(new Promise(resolve => { releaseTimezone = resolve; }));
  statementRead.mockImplementation(async (_account, timezone) => ({ zone: await timezone, owed: 70 }));
  const pending = GET(req());
  await new Promise<void>(resolve => setImmediate(resolve));
  const beforeAuthorization = { timezone: from.mock.calls.length, statement: statementRead.mock.calls.length };
  const account = { id: "a1", restaurant_id: "r1" };
  releaseAccount(account);
  await new Promise<void>(resolve => setImmediate(resolve));
  const beforeTimezone = { timezone: timezoneRead.mock.calls.length, statement: statementRead.mock.calls.length };
  releaseTimezone({ data: { timezone: "Asia/Tokyo" }, error: null });
  const response = await pending;
  expect({ denied: denied.status, deniedReads, missing: missing.status, missingReads, beforeAuthorization, beforeTimezone,
    accountScope: accountLookup.mock.calls, timezoneScope: timezoneScope.mock.calls, status: response.status, body: await response.json(),
  }).toEqual({ denied: 403, deniedReads: { accounts: 0, timezone: 0, statement: 0 }, missing: 404,
    missingReads: { timezone: 0, statement: 0 }, beforeAuthorization: { timezone: 0, statement: 0 }, beforeTimezone: { timezone: 1, statement: 1 },
    accountScope: [["r1", "a1"], ["r1", "a1"]], timezoneScope: [["id", "r1"]], status: 200, body: { account, statement: { zone: "Asia/Tokyo", owed: 70 } },
  });
});
