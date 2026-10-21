import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  orders: [{ id: "o1", total: 100, currency: "MXN", paid: false, created_at: "2026-10-20T10:00:00Z", items: [] }],
  record: vi.fn(async () => {}),
  create: vi.fn(async () => ({ id: "cs_test", url: "https://stripe.test" })),
}));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { create: state.create } }; } }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false, isRateLimited: async () => false, clientKey: () => "test" }));
vi.mock("@/lib/table-session", () => ({ staffOpenedBill: async () => false }));
vi.mock("@/lib/split-service", () => ({ splitInProgress: async () => false }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null }));
vi.mock("@/lib/payment-coverage", () => ({ PaymentAttributionRequired: class extends Error {}, paymentCoverage: async () => new Map() }));
vi.mock("@/lib/bill-data", () => ({ fetchTableBill: async () => state.orders }));
vi.mock("@/lib/table-bill", () => ({ billWindowStart: () => new Date(0), MAX_BILL_ORDERS: 200, tableBill: () => ({ total: 100 }) }));
vi.mock("@/lib/diner-checkout", () => ({ recordDinerCheckout: state.record }));
vi.mock("@/lib/accounts", () => ({ normalizeCode: () => "account-code" }));
vi.mock("@/lib/accounts-server", () => ({ accountByCode: async () => ({ id: "a1", restaurant_id: "r1", name: "Diner" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: { outcome: "open", checkout: "ac1", amount: 100, tip: 0 }, error: null }), from: (table: string) => {
  const b: Record<string, unknown> = {};
  let offset = 0;
  b.range = (from: number) => { offset = from; return b; };
  b.order = () => b;
  let ids: string[] | null = null;
  b.in = (_field: string, values: string[]) => { ids = values; return b; };
  for (const m of ["select", "eq", "gte", "lte", "is", "neq", "update"]) b[m] = () => b;
  const data = () => table === "restaurants" ? { id: "r1", currency: "USD", stripe_account_id: "acct_1", stripe_charges_enabled: true }
    : table === "bill_splits" ? { id: "s1", order_ids: state.orders.filter(o => o.created_at <= "2026-10-20T11:00:00Z").map(o => o.id), restaurant_id: "r1", session_id: "t1", status: "locked", locked_at: "2026-10-20T11:00:00Z", shares: 2, amount: 100 }
    : table === "account_checkouts" ? { order_ids: state.orders.map(o => o.id) }
    : table === "bill_split_claims" ? { share_no: 1, amount: 50, paid_at: null }
    : table === "table_sessions" ? { id: "t1" } : offset > 0 ? [] : state.orders.filter(o => !ids || ids.includes(o.id));
  b.single = b.maybeSingle = async () => ({ data: data(), error: null });
  b.then = (resolve: (r: unknown) => void) => Promise.resolve({ data: data(), error: null }).then(resolve);
  return b;
} }) }));
const bill = await import("@/app/api/bill/pay/route");
const split = await import("@/app/api/split/pay/route");
const account = await import("@/app/api/account/pay/route");
beforeEach(() => { state.create.mockClear(); state.record.mockReset().mockResolvedValue(undefined); state.orders = [{ id: "o1", total: 100, currency: "MXN", paid: false, created_at: "2026-10-20T10:00:00Z", items: [] }]; });
const request = () => new NextRequest("http://localhost/pay", { method: "POST", body: JSON.stringify({
  c: "account-code", expected: 100, restaurantId: "r1", tableId: "t1", orderIds: ["o1", "o2"], splitId: "s1", sessionId: "t1", diner: "d1", ownOrderIds: ["o1", "o2"],
}) });
it.each([["bill", bill.POST], ["split", split.POST], ["account", account.POST]] as const)("%s charges original MXN after settings switch to USD", async (_name, post) => {
  expect((await post(request())).status).toBe(200);
  expect(state.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ currency: "MXN", stripeAccount: "acct_1", orderIds: ["o1"] }), expect.any(Function));
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ line_items: [expect.objectContaining({ price_data: expect.objectContaining({ currency: "mxn" }) })] }), expect.anything());
});
it.each([["bill", bill.POST], ["split", split.POST], ["account", account.POST]] as const)("%s refuses a scope mixing currencies before charging", async (_name, post) => {
  state.orders.push({ ...state.orders[0], id: "o2", currency: "USD" });
  const result = await post(request());
  expect(result.status).toBe(409);
  expect(await result.json()).toEqual({ error: "apiErr.mixedCurrencies" });
  expect(state.create).not.toHaveBeenCalled();
});

it("split refuses a later USD order beside a frozen MXN share", async () => {
  state.orders.push({ ...state.orders[0], id: "o2", currency: "USD", created_at: "2026-10-20T12:00:00Z" });
  expect((await split.POST(request())).status).toBe(409);
  expect(state.create).not.toHaveBeenCalled();
});

it.each([["bill", bill.POST], ["split", split.POST], ["account", account.POST]] as const)("%s returns no payment URL when provenance cannot be saved", async (_name, post) => {
  state.record.mockRejectedValueOnce(new Error("provenance unavailable"));
  const result = await post(request());
  expect(result.status).toBe(502);
  expect(await result.json()).not.toHaveProperty("url");
});
