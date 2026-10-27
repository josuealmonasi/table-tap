import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  orders: [{ id: "o1", tip: 0, total: 100, currency: "MXN", diner: "d1", paid: false, created_at: "2026-10-20T10:00:00Z", items: [] }],
  principal: 100,
  orderFee: 0.75,
  shareNo: 1,
  prior: null as { url: string } | null,
  reserve: vi.fn(async () => ({ id: null, cents: 0 })),
  record: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  create: vi.fn(async () => ({ id: "cs_test", url: "https://stripe.test" })),
}));
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => ({ id: "d1", sessionId: "t1", restaurantId: "r1", tableId: "t1", closed: false }) }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { create: state.create } }; } }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false, isRateLimited: async () => false, clientKey: () => "test" }));
vi.mock("@/lib/table-session", () => ({ staffOpenedBill: async () => false }));
vi.mock("@/lib/split-service", () => ({ splitInProgress: async () => false }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { order_fee: state.orderFee } }) }));
vi.mock("@/lib/platform-fee", () => ({ NO_FEE: { id: null, cents: 0 }, reserveFee: state.reserve, reserveFeeCents: state.reserve, feeMetadata: () => ({}), releaseFee: async () => {}, stripeRefusedOutright: () => false, attachFeeSession: async () => {}, feeRefOpen: async () => false }));
vi.mock("@/lib/payment-coverage", () => ({ PaymentAttributionRequired: class extends Error {}, paymentCoverage: async () => new Map(), paymentCoverageDetails: async () => new Map() }));
vi.mock("@/lib/bill-data", () => ({ fetchTableBill: async () => state.orders }));
vi.mock("@/lib/table-bill", () => ({ billWindowStart: () => new Date("2026-10-20T04:00:00Z"), MAX_BILL_ORDERS: 200, tableBill: () => ({ total: 100 }) }));
vi.mock("@/lib/diner-attempt", () => ({
  DinerAttemptRejected: class extends Error {},
  resumeDinerAttempt: async () => state.prior,
  openDinerAttempt: async (_stripe: unknown, params: unknown, quote: unknown) => {
    const session = await (state.create as (...args: unknown[]) => Promise<unknown>)(params, {});
    await state.record(session, quote, () => {});
    return session;
  },
}));
vi.mock("@/lib/diner-checkout", () => ({ recordDinerCheckout: state.record }));
vi.mock("@/lib/accounts", () => ({ normalizeCode: () => "account-code" }));
vi.mock("@/lib/accounts-server", () => ({ accountByCode: async () => ({ id: "a1", restaurant_id: "r1", name: "Diner" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: { outcome: "open", checkout: "ac1", amount: 100, tip: 0 }, error: null }), from: (table: string) => {
  const b: Record<string, unknown> = {};
  let offset = 0;
  let cutoff = "";
  b.gte = (_field: string, value: string) => { cutoff = value; return b; };
  b.range = (from: number) => { offset = from; return b; };
  b.order = () => b;
  let ids: string[] | null = null;
  b.in = (_field: string, values: string[]) => { ids = values; return b; };
  for (const m of ["select", "eq", "lte", "is", "neq", "update"]) b[m] = () => b;
  const data = () => table === "restaurants" ? { id: "r1", currency: "USD", stripe_account_id: "acct_1", stripe_charges_enabled: true }
    : table === "bill_splits" ? { id: "s1", order_ids: state.orders.filter(o => o.created_at <= "2026-10-20T11:00:00Z").map(o => o.id), restaurant_id: "r1", session_id: "t1", status: "locked", locked_at: "2026-10-20T11:00:00Z", shares: 2, amount: 100, food_principal: state.principal }
    : table === "account_checkouts" ? { order_ids: state.orders.map(o => o.id) }
    : table === "bill_split_claims" ? { share_no: state.shareNo, amount: 50, paid_at: null }
    : table === "table_sessions" ? { id: "t1" } : offset > 0 ? [] : state.orders.filter(o => (!ids || ids.includes(o.id)) && (!cutoff || o.created_at >= cutoff));
  b.single = b.maybeSingle = async () => ({ data: data(), error: null });
  b.then = (resolve: (r: unknown) => void) => Promise.resolve({ data: data(), error: null }).then(resolve);
  return b;
} }) }));
const bill = await import("@/app/api/bill/pay/route");
const split = await import("@/app/api/split/pay/route");
const account = await import("@/app/api/account/pay/route");
beforeEach(() => { state.prior = null; state.orderFee = 0.75; state.shareNo = 1; state.principal = 100; state.reserve.mockClear(); state.create.mockClear(); state.record.mockReset().mockResolvedValue(undefined); state.orders = [{ id: "o1", tip: 0, total: 100, currency: "MXN", diner: "d1", paid: false, created_at: "2026-10-20T10:00:00Z", items: [] }]; });
const request = () => new NextRequest("http://localhost/pay", { method: "POST", body: JSON.stringify({
  c: "account-code", expected: 100, restaurantId: "r1", tableId: "t1", orderIds: state.orders.map(o => o.id), splitId: "s1", sessionId: "t1", diner: "d1", ownOrderIds: ["o1", "o2"],
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

it("S21 split charges the MX$55 shown for a fifty-peso share and ten-percent tip", async () => {
  const response = await split.POST(new NextRequest("http://localhost/pay", { method: "POST", body: JSON.stringify({
    restaurantId: "r1", tableId: "t1", sessionId: "t1", splitId: "s1", diner: "d1", ownOrderIds: ["o1"], tipPct: 10,
  }) }));
  expect(response.status).toBe(200);
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ line_items: [expect.objectContaining({
    price_data: expect.objectContaining({ currency: "mxn", unit_amount: 5500 }),
  })], metadata: expect.objectContaining({ settle_tip: "5" }) }),expect.anything());
});

it.each([["bill", bill.POST], ["split", split.POST], ["account", account.POST]] as const)("%s returns no payment URL when provenance cannot be saved", async (_name, post) => {
  state.record.mockRejectedValueOnce(new Error("provenance unavailable"));
  const result = await post(request());
  expect(result.status).toBe(502);
  expect(await result.json()).not.toHaveProperty("url");
});

it("bill caps its fee on four pesos of food, excluding four pesos of existing tip", async () => {
  state.orders = [{ ...state.orders[0], total: 8, tip: 4 } as typeof state.orders[number]];
  await bill.POST(new NextRequest("http://localhost/pay", { method: "POST", body: JSON.stringify({ restaurantId: "r1", tableId: "t1", sessionId: "t1", orderIds: ["o1"] }) }));
  expect(state.reserve).toHaveBeenLastCalledWith("r1", expect.anything(), 400, "bill");
});

it("E9 a split's fee slices use frozen food principal, excluding the existing tips", async () => {
  state.principal = 4;
  state.orders = [{ ...state.orders[0], total: 8, tip: 4 }];
  expect((await split.POST(request())).status).toBe(200);
  expect(state.reserve).toHaveBeenLastCalledWith("r1", expect.anything(), 20, "split");
});
it("E11 a valid older sitting's displayed debt remains payable", async () => {
  state.orders = [{ ...state.orders[0], created_at: "2026-10-18T10:00:00Z" }];
  expect((await bill.POST(request())).status).toBe(200);
  expect(state.create).toHaveBeenCalled();
});

it.each([["bill", bill.POST], ["split", split.POST], ["account", account.POST]] as const)("E8 %s reuses its open payment page before reserving another fee", async (_name, post) => {
  state.prior = { url: "https://stripe.test/existing" };
  const response = await post(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(state.prior);
  expect(state.create).not.toHaveBeenCalled();
  expect(state.reserve).not.toHaveBeenCalled();
});
it("E9 account checkout also excludes existing tips from its fee base", async () => {
  state.orders = [{ ...state.orders[0], total: 8, tip: 4 }];
  expect((await account.POST(request())).status).toBe(200);
  expect(state.reserve).toHaveBeenLastCalledWith("r1", expect.anything(), 400, "account");
});
it("E11 a selection outside the displayed sitting asks for review, never says paid", async () => {
  const req = new NextRequest("http://localhost/pay", { method: "POST", body: JSON.stringify({ restaurantId: "r1", tableId: "t1", sessionId: "t1", orderIds: ["foreign"] }) });
  const response = await bill.POST(req);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.billChanged" });
  expect(state.create).not.toHaveBeenCalled();
});

it.each([[0, 38], [1, 37]])("E9 zero-based share %s carries exactly %s fee cents", async (share, cents) => {
  state.shareNo = share;
  expect((await split.POST(request())).status).toBe(200);
  expect(state.reserve).toHaveBeenLastCalledWith("r1", expect.anything(), cents, "split");
});
it("E8 a zero-fee split still opens the shared durable attempt", async () => {
  state.orderFee = 0;
  expect((await split.POST(request())).status).toBe(200);
  expect(state.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scopeKey: "split:s1:1", foodPrincipal: 100 }), expect.anything());
  expect(state.reserve).not.toHaveBeenCalled();
});
