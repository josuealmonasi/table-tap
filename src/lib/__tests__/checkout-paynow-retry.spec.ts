import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { orderRequestScope } from "@/lib/order-request";

const state = vi.hoisted(() => ({
  orders: [] as Record<string, unknown>[],
  sessions: [] as { id: string; url: string; status: string }[],
  creates: vi.fn(), retrieves: vi.fn(), reserve: vi.fn(), release: vi.fn(),
  claim: vi.fn(), releaseCoupon: vi.fn(), releaseFee: vi.fn(), fee: vi.fn(), logCoupon: vi.fn(), rpc: vi.fn(),
  insertError: null as { code: string; message: string } | null,
  readError: false, nextId: 0, inserts: 0, race: false,
  winnerSaved: Promise.resolve(), saveWinner: () => {},
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: state.rpc,
  from: (table: string) => {
    let operation = "select";
    let values: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    const execute = async () => {
      if (table === "restaurants") return { data: {
        id: "r", accepting_orders: true, currency: "MXN", service_pct: 0,
        service_enabled: false, stripe_account_id: "acct_r", stripe_charges_enabled: true,
      }, error: null };
      const matches = () => state.orders.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
      if (operation === "insert") {
        state.inserts++;
        if (state.insertError) return { data: null, error: state.insertError };
        if (values.request_ref && state.orders.some(row => row.restaurant_id === values.restaurant_id && row.request_ref === values.request_ref)) {
          if (state.race) await state.winnerSaved;
          return { data: null, error: { code: "23505", message: 'duplicate key violates unique constraint "orders_request_once"' } };
        }
        const row = { ...values, id: `order-${++state.nextId}` };
        state.orders.push(row);
        return { data: row, error: null };
      }
      if (operation === "update") {
        matches().forEach(row => Object.assign(row, values));
        state.saveWinner();
      }
      if (operation === "delete") state.orders = state.orders.filter(row => !matches().includes(row));
      if (state.readError) return { data: null, error: { message: "read failed" } };
      return { data: matches()[0] ?? null, error: null };
    };
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      insert: (row: Record<string, unknown>) => { values = row; operation = "insert"; return query; },
      update: (row: Record<string, unknown>) => { values = row; operation = "update"; return query; },
      delete: () => { operation = "delete"; return query; },
      single: execute, maybeSingle: execute,
      then: (resolve: (value: unknown) => void) => execute().then(resolve),
    };
    return query;
  },
}) }));
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { create: state.creates, retrieve: state.retrieves } } } }));
vi.mock("@/lib/diner-checkout", () => ({ recordDinerCheckout: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }) }));
vi.mock("@/lib/plan", () => ({ can: () => true }));
vi.mock("@/lib/table-member-cookie", () => ({ memberHash: () => null }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/checkout/orderable-now", () => ({ orderableNow: async () => ({ closedNow: false, onOpenMenu: () => true }) }));
vi.mock("@/lib/checkout/verified-lines", () => ({ verifiedLines: async () => ({
  ok: true, lines: [{ itemId: "dish", name: "Taco", emoji: "", price: 100, qty: 1, mods: {} }],
}) }));
vi.mock("@/lib/checkout/claim-coupon", () => ({ claimCheckoutCoupon: state.claim, logCheckoutCoupon: state.logCoupon }));
vi.mock("@/lib/coupon-service", async importOriginal => ({ ...await importOriginal<object>(), releaseCoupon: state.releaseCoupon }));
vi.mock("@/lib/checkout/app-fee", () => ({ checkoutFee: state.fee }));
vi.mock("@/lib/platform-fee", async importOriginal => ({ ...await importOriginal<object>(), releaseFee: state.releaseFee }));
vi.mock("@/lib/stock-service", () => ({ reserveStock: state.reserve, releaseStock: state.release, raiseStockNotifications: async () => {} }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
const { POST } = await import("@/app/api/checkout/route");
const post = (changes: Record<string, unknown> = {}) => POST(new NextRequest("https://test/api/checkout", {
  method: "POST", body: JSON.stringify({ restaurantId: "r", tableId: null,
    ref: "00000000-0000-4000-8000-000000000003", items: [{ itemId: "dish", qty: 1 }], ...changes }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.orders = []; state.sessions = []; state.nextId = 0; state.inserts = 0;
  state.race = false; state.readError = false; state.insertError = null;
  state.winnerSaved = new Promise<void>(resolve => { state.saveWinner = resolve; });
  state.claim.mockResolvedValue({ coupon: null });
  state.rpc.mockResolvedValue({ data: null, error: null });
  state.fee.mockImplementation(async () => ({ id: `fee-${state.fee.mock.calls.length}`, cents: 0 }));
  state.reserve.mockResolvedValue({ ok: true, reservationId: "stock", low: [] });
  state.retrieves.mockImplementation(async (id: string) => state.sessions.find(session => session.id === id));
  state.creates.mockImplementation(async () => {
    const id = `cs_${state.sessions.length + 1}`;
    const session = { id, url: `https://checkout.test/${id}`, status: "open" };
    state.sessions.push(session);
    return session;
  });
});
afterEach(() => vi.restoreAllMocks());

it("same pay-now reference returns one order and one open session", async () => {
  const first = await post(); const second = await post();
  expect([first.status, second.status]).toEqual([200, 200]);
  expect(await second.json()).toEqual(await first.json());
  expect(state.orders).toHaveLength(1); expect(state.creates).toHaveBeenCalledTimes(1);
  expect(state.reserve).toHaveBeenCalledTimes(1); expect(state.claim).toHaveBeenCalledTimes(1);
  expect(state.retrieves).toHaveBeenCalledWith("cs_1", {}, { stripeAccount: "acct_r" });
});

it.each([{ note: "No onions" }, { items: [{ itemId: "dish", qty: 2 }] }, { tipAmount: 10 }, { couponCode: "OTHER" }])(
  "changed pay-now request with the same reference returns retryConflict: %j", async changes => {
    expect((await post()).status).toBe(200);
    const changed = await post(changes);
    expect(changed.status).toBe(409); expect(await changed.json()).toEqual({ error: "apiErr.retryConflict" });
    expect(state.orders).toHaveLength(1); expect(state.reserve).toHaveBeenCalledTimes(1);
  },
);

it("concurrent 23505 returns the winner and gives back only the losing stock, coupon and fee", async () => {
  state.race = true;
  state.claim.mockResolvedValue({ coupon: { id: "coupon", code: "SAVE", kind: "fixed", value: 0, min_subtotal: 0 } });
  let bothReserved = () => {};
  const ready = new Promise<void>(resolve => { bothReserved = resolve; });
  let count = 0;
  state.reserve.mockImplementation(async () => {
    const reservationId = `stock-${++count}`;
    if (count === 2) bothReserved();
    await ready;
    return { ok: true, reservationId, low: [] };
  });
  const responses = await Promise.all([post({ couponCode: "SAVE" }), post({ couponCode: "SAVE" })]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect(await responses[1].json()).toEqual(await responses[0].json());
  expect(state.inserts).toBe(2); expect(state.orders).toHaveLength(1); expect(state.creates).toHaveBeenCalledTimes(1);
  expect(state.release).toHaveBeenCalledExactlyOnceWith("r", "stock-2");
  expect(state.releaseCoupon).toHaveBeenCalledExactlyOnceWith("coupon");
  expect(state.releaseFee).toHaveBeenCalledExactlyOnceWith("fee-2");
  expect(state.logCoupon).toHaveBeenCalledTimes(1);
});

it("expired session conflicts until deletion, then the reference creates one new order", async () => {
  const original = await (await post()).json();
  state.sessions[0].status = "expired";
  expect((await post()).status).toBe(409);
  // The abandon handler deletes the old order and frees its reference. A new
  // order after that deletion replaces it; two payable orders never coexist.
  state.orders = [];
  const retry = await post(); const reopened = await retry.json();
  expect(retry.status).toBe(200); expect(state.orders).toHaveLength(1);
  expect(reopened.orderId).not.toBe(original.orderId); expect(reopened.url).not.toBe(original.url);
  expect(state.creates).toHaveBeenCalledTimes(2);
});

it("a retry while its session is opening asks to retry without taking anything else", async () => {
  await post(); delete state.orders[0].stripe_session_id;
  const retry = await post();
  expect(retry.status).toBe(409); expect(await retry.json()).toEqual({ error: "apiErr.checkoutOpening" });
  expect(state.reserve).toHaveBeenCalledTimes(1); expect(state.creates).toHaveBeenCalledTimes(1);
});

it("a completed session or an order already sent cannot open another payment", async () => {
  await post(); state.sessions[0].status = "complete";
  expect((await post()).status).toBe(409);
  state.sessions[0].status = "open"; state.orders[0].status = "received";
  expect((await post()).status).toBe(409); expect(state.creates).toHaveBeenCalledTimes(1);
});

it("no reference keeps creating independent orders", async () => {
  expect((await post({ ref: undefined })).status).toBe(200);
  expect((await post({ ref: undefined })).status).toBe(200);
  expect(state.orders).toHaveLength(2); expect(state.creates).toHaveBeenCalledTimes(2);
});

it("pay-now session creation uses an order-derived Stripe key", async () => {
  const response = await post(); const result = await response.json();
  expect(response.status).toBe(200);
  expect(state.creates.mock.calls[0][1]).toEqual({ stripeAccount: "acct_r", idempotencyKey: `checkout-${result.orderId}` });
});

it("deferred retry scopes stay byte-identical and differ from pay-now scopes", async () => {
  const scope = orderRequestScope("checkout::", {
    items: [{ itemId: "dish", qty: 1, name: "Taco", emoji: "", price: 100, mods: {} }], tableId: null,
  });
  state.rpc.mockResolvedValue({ data: { orderId: "deferred", sessionId: null }, error: null });
  expect((await post({ payLater: true })).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("order_intent_result", expect.objectContaining({ p_scope: scope }));
  await post(); expect(state.orders[0].request_scope).not.toBe(scope);
  state.orders[0].request_scope = scope;
  expect((await post()).status).toBe(409);
});

it("the same reference in another restaurant cannot return this restaurant's page", async () => {
  await post(); expect((await post({ restaurantId: "other" })).status).toBe(200);
  expect(state.orders).toHaveLength(2); expect(state.creates).toHaveBeenCalledTimes(2);
});

it.each(["read", "insert"])("a %s failure does not get mistaken for a winning request", async failure => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  if (failure === "read") state.readError = true;
  else state.insertError = { code: "23505", message: 'duplicate key violates unique constraint "another_index"' };
  const response = await post(); expect(response.status).toBe(500);
  expect(state.orders).toHaveLength(0); expect(state.creates).not.toHaveBeenCalled();
  expect(state.reserve).toHaveBeenCalledTimes(failure === "read" ? 0 : 1);
  expect(state.release).toHaveBeenCalledTimes(failure === "read" ? 0 : 1);
});
