import { beforeEach, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ record: null as unknown, restaurant: "acct_a", orderRestaurant: "r1", orderCurrency: "MXN", missing: false, writes: [] as string[], down: false }));
vi.mock("@/lib/stripe", async () => {
  const { default: Stripe } = await import("stripe");
  return { stripe: new Stripe("sk_test_provenance") };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (fn: string) => {
    state.writes.push(fn);
    return { data: { settled: [], not_settled: [], tip_on: null }, error: null };
  },
  from: (table: string) => {
    const b: Record<string, unknown> = {};
    let offset = 0;
    b.range = (from: number) => { offset = from; return b; };
    for (const method of ["select", "eq", "in", "is", "order", "limit"]) b[method] = () => b;
    b.update = () => { state.writes.push(table); return b; };
    const result = () => ({ data: table === "diner_checkouts" ? state.record : table === "restaurants"
      ? { stripe_account_id: state.restaurant } : table === "bill_splits" ? { id: "s1", restaurant_id: "r1", session_id: "t1" }
      : offset > 0 || state.missing ? [] : [{ id: "o1", restaurant_id: state.orderRestaurant, currency: state.orderCurrency }],
      error: state.down ? { message: "offline" } : null });
    b.maybeSingle = b.single = async () => {
      const answer = result();
      return table === "orders" ? { ...answer, data: (answer.data as unknown[])[0] ?? null } : answer;
    };
    b.then = (resolve: (r: unknown) => void) => Promise.resolve(result()).then(resolve);
    return b;
  },
}) }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/platform-fee", () => ({
  takeFee: async () => { state.writes.push("fee taken"); },
  releaseSessionFee: async () => { state.writes.push("fee released"); },
}));
vi.mock("@/lib/stripe-connect", () => ({ syncConnectAccount: async () => {} }));

const { POST } = await import("@/app/api/webhooks/stripe/connect/route");
const metadata = { order_id: "o1", restaurant_id: "r1" };
const session = { id: "cs_ours", object: "checkout.session", mode: "payment", livemode: false,
  amount_total: 100000, currency: "mxn", payment_status: "paid", payment_intent: "pi_ours", metadata };
async function deliver(change: Record<string, unknown> = {}, eventChange: Record<string, unknown> = {}) {
  const body = JSON.stringify({ id: "evt_test", object: "event", type: "checkout.session.completed",
    account: "acct_a", livemode: false, data: { object: { ...session, ...change } }, ...eventChange });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_provenance" });
  try { await POST(new NextRequest("http://localhost/api/webhooks/stripe/connect", {
    method: "POST", headers: { "stripe-signature": signature }, body,
  })); } catch { /* A refusal must leave the ledger untouched even when Stripe retries. */ }
}
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_provenance");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET_CONNECT", "whsec_provenance");
  state.record = { stripe_session_id: "cs_ours", restaurant_id: "r1", stripe_account_id: "acct_a",
    livemode: false, currency: "MXN", amount_cents: 100000, metadata, order_ids: ["o1"] };
  state.restaurant = "acct_a";
  state.orderRestaurant = "r1";
  state.orderCurrency = "MXN";
  state.missing = false;
  state.writes = [];
  state.down = false;
});
it.each([
  ["wrong connected account", {}, { account: "acct_b" }],
  ["wrong event mode", {}, { livemode: true }],
  ["wrong session mode", { livemode: true }, {}],
  ["MX$10 for MX$1,000", { amount_total: 1000 }, {}],
  ["another restaurant's order", { metadata: { ...metadata, order_id: "other" } }, {}],
  ["wrong currency", { currency: "usd" }, {}],
  ["cloned metadata on an owner-created session", { id: "cs_forged" }, {}],
  ["changed scope", { metadata: { ...metadata, split_id: "foreign" } }, {}],
])("refuses a correctly signed event with %s before any write", async (_name, change, eventChange) => {
  await deliver(change, eventChange);
  expect(state.writes).toEqual([]);
});
it("refuses a session created before durable provenance existed", async () => {
  state.record = null;
  await deliver();
  expect(state.writes).toEqual([]);
});
it("fails closed when the provenance read fails", async () => {
  state.down = true;
  await deliver();
  expect(state.writes).toEqual([]);
});
it("checks the restaurant's current connected account too", async () => {
  state.restaurant = "acct_replaced";
  await deliver();
  expect(state.writes).toEqual([]);
});
it("verifies expiry before releasing fees, stock or coupons", async () => {
  await deliver({ payment_status: "unpaid" }, { type: "checkout.session.expired", account: "acct_b" });
  expect(state.writes).toEqual([]);
});
it("settles a recorded session on the right account in test mode", async () => {
  await deliver();
  expect(state.writes).toContain("settle_card_orders_v2");
});

it("refuses persisted scopes whose orders now belong to another restaurant", async () => {
  state.orderRestaurant = "r2";
  await deliver();
  expect(state.writes).toEqual([]);
});
it("refuses persisted scopes whose order currency differs", async () => {
  state.orderCurrency = "USD";
  await deliver();
  expect(state.writes).toEqual([]);
});
it("accepts live events only when the secret key and durable record are live", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_provenance");
  state.record = { ...(state.record as object), livemode: true };
  await deliver({ livemode: true }, { livemode: true });
  expect(state.writes).toContain("settle_card_orders_v2");
});
it("cannot settle directly through an exported helper without provenance", async () => {
  const { settleCardOrders } = await import("@/lib/card-settle");
  const { settleAccountCheckout, abandonAccountCheckout } = await import("@/lib/account-checkout");
  const raw = { ...session } as unknown as Stripe.Checkout.Session;
  await expect(settleCardOrders(["o1"], raw, "forged")).rejects.toThrow("provenance");
  await expect(settleAccountCheckout(raw)).rejects.toThrow("provenance");
  await expect(abandonAccountCheckout(raw)).rejects.toThrow("provenance");
  expect(state.writes).toEqual([]);
});
it("a verified session cannot be used to settle other orders through a lower-level helper", async () => {
  const { verifyDinerCheckout } = await import("@/lib/diner-checkout");
  const { settleCardOrders } = await import("@/lib/card-settle");
  const raw = { ...session } as unknown as Stripe.Checkout.Session;
  await verifyDinerCheckout(raw, { account: "acct_a", livemode: false });
  state.writes = [];
  await expect(settleCardOrders(["foreign"], raw, "forged")).rejects.toThrow("scope");
  expect(state.writes).toEqual([]);
});
it.each([
  ["bill", { restaurant_id: "r1", settle_order_ids: "o1", settle_tip: "0" }, "settle_card_orders_v2"],
  ["split", { restaurant_id: "r1", split_id: "s1", split_share: "0", split_amount: "1000", settle_tip: "0" }, "settle_split_share_v2"],
  ["account", { restaurant_id: "r1", account_checkout: "ac1" }, "account_checkout_settle_v2"],
])("authenticates a %s scope before dispatching its settlement", async (_shape, frozen, rpc) => {
  state.record = { ...(state.record as object), metadata: frozen };
  await deliver({ metadata: frozen });
  expect(state.writes).toContain(rpc);
});

it("authenticates repeated expiry even after its pending order was deleted", async () => {
  await deliver({ payment_status: "unpaid" }, { type: "checkout.session.expired" });
  expect(state.writes).toContain("abandon_checkout");
  state.writes = [];
  state.missing = true;
  await deliver({ payment_status: "unpaid" }, { type: "checkout.session.expired" });
  expect(state.writes).toEqual(["fee released"]);
});
