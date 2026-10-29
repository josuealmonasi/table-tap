import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { rpc, resolve, log } = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: {
    id: "r1", stripe_account_id: "acct_now", stripe_charges_enabled: true,
  }, error: null }) };
  return q;
} }) }));
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r1", email: "cashier" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/accounts-server", () => ({ accountById: async () => ({ id: "a1", name: "Ana" }),
  accountByCode: async () => ({ id: "a1", restaurant_id: "r1" }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: log }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => false, clientKey: () => "phone" }));
vi.mock("stripe", () => ({ default: class Stripe {} }));
vi.mock("@/lib/diner-attempt", () => ({ resumeDinerAttempt: async () => null, openDinerAttempt: vi.fn(), DinerAttemptRejected: class extends Error {} }));
const { POST: settle } = await import("@/app/api/accounts/settle/route");
const { POST: open } = await import("@/app/api/account/pay/route");
const request = (body: unknown) => new NextRequest("https://test/api/account", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); resolve.mockResolvedValue("closed"); });

it.each([undefined, "MXN"])("account collection retries its exact %s quote after expiry", async currency => {
  rpc.mockResolvedValueOnce({ data: { outcome: "paying" }, error: null })
    .mockResolvedValueOnce({ data: { outcome: "paid", amount: 110, tip: 10 }, error: null });
  const res = await settle(request({ accountId: "a1", expected: 100, tip: 10, method: "cash", ref: "same", currency }));
  expect(res.status).toBe(200); expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected: 100, p_tip: 10, p_ref: "account:same" });
  expect(resolve).toHaveBeenCalledWith("r1", expect.objectContaining({ accountId: "a1" }));
  expect(log).toHaveBeenCalledTimes(1);
});
it.each(["unresolved", "unverified"])("a %s account page leaves collection refused", async result => {
  resolve.mockResolvedValue(result); rpc.mockResolvedValue({ data: { outcome: "paying" }, error: null });
  const res = await settle(request({ accountId: "a1", expected: 100, method: "cash" }));
  expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: "apiErr.accountPayingOnline" });
  expect(rpc).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled();
});
it.each([undefined, "MXN"])("account card opening retries its exact %s quote without silently accepting a new balance", async currency => {
  rpc.mockResolvedValueOnce({ data: { outcome: "paying" }, error: null })
    .mockResolvedValueOnce({ data: { outcome: "changed" }, error: null });
  const res = await open(request({ c: "K7QM3XW9TB4R", expected: 100, tipAmount: 10, currency }));
  expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: "apiErr.accountStatementChanged" });
  expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected: 100, p_tip: 10, p_fee: 0 });
});
