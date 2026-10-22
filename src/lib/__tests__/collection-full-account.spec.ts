import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ record: vi.fn(), close: vi.fn(), rpc: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r", email: "waiter" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, _vars: unknown, extra: object) => Response.json({ error, ...extra },{ status }) }));
vi.mock("@/lib/reviewed-collection", () => ({ recordReviewed: mocks.record }));
vi.mock("@/lib/part-payment", () => ({ closeBill: mocks.close }));
vi.mock("@/lib/activity-log", () => ({ logEvent: mocks.log }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/accounts-server", () => ({ accountById: async () => ({ id: "a", name: "Diner" }) }));
const table = await import("@/app/api/table-payment/route");
const account = await import("@/app/api/accounts/settle/route");
const request = (body: object) => new NextRequest("https://test/collect", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.close.mockResolvedValue(true); });

it("S21 whole-table settlement refuses a changed reviewed balance before closing", async () => {
  mocks.record.mockResolvedValue({ changed: true, owed: 50 });
  const result = await table.POST(request({ tableId: "t", settlement: "cash", expected: 100, currency: "USD", ref: "one" }));
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ owed: 50, currency: "USD" });
  expect(mocks.close).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
});
it("S21 whole-table cash returns the actual original-currency receipt", async () => {
  mocks.record.mockResolvedValue({ wrote: true, landed: 100, tip: 10 });
  const result = await table.POST(request({ tableId: "t", settlement: "cash", expected: 100, currency: "USD", ref: "one" }));
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ amount: 100, tip: 10, currency: "USD" });
  expect(mocks.close).toHaveBeenCalledWith(expect.anything(),"t","cash","USD");
});
it("S21 account collection writes only the reviewed USD debt and confirms the recorded tip", async () => {
  mocks.rpc.mockResolvedValue({ data: { outcome: "paid", amount: 110, tip: 10 }, error: null });
  const result = await account.POST(request({ accountId: "a", expected: 100, tip: 10, method: "cash", currency: "USD", ref: "one" }));
  expect(result.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("account_settle_currency_v1", expect.objectContaining({ p_currency: "USD", p_expected: 100, p_tip: 10 }));
  expect(await result.json()).toMatchObject({ amount: 110, tip: 10, currency: "USD" });
});

it("S21 still closes a fully collected table after a failed close without recording it again", async () => {
  const result = await table.POST(request({ tableId: "t", settlement: "cash", expected: 0, currency: "USD", ref: "close" }));
  expect(result.status).toBe(200);
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledWith(expect.anything(),"t","cash","USD");
});
