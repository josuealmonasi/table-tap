import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/subscription-price", () => ({
  subscriptionPlan: async () => "servicio", registerSubscriptionPrice: async () => {},
}));
const customerCreate = vi.fn();
const customerList = vi.fn();
let saved: Record<string, unknown>;
const sessionCreate = vi.fn();
const sessionList = vi.fn();
const sessionExpire = vi.fn();
const subscriptionList = vi.fn();
const subscriptionRetrieve = vi.fn();
const subscriptionUpdate = vi.fn();
const productCreate = vi.fn();
const priceCreate = vi.fn();
const invoiceRetrieve = vi.fn();
const portalCreate = vi.fn();
const sync = vi.fn();
const rpc = vi.fn();
let locked = false;
let restaurant: Record<string, unknown>;
const failure = { data: null, error: { message: "database unavailable" } };
let writeFailure = false;
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r1", email: "owner@test.com" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-server", () => ({ allPlans: async () => [
  { plan: "casa", monthly_price: 1499, stripe_price_id: null }, { plan: "servicio", monthly_price: 699 },
], foundersTaken: async () => 0 }));
vi.mock("@/lib/subscription-sync", () => ({ applySubscription: (...args: unknown[]) => sync(...args) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (...args: unknown[]) => rpc(...args),
  from: (table: string) => {
    let patch: Record<string, unknown> | undefined;
    const q = {
      select: () => q, eq: () => q,
      update: (value: Record<string, unknown>) => { patch = value; return q; },
      single: async () => ({ data: restaurant, error: null }),
      maybeSingle: async () => ({ data: table === "restaurant_billing_operations" ? saved : restaurant, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (patch && !writeFailure) Object.assign(restaurant, patch);
        return Promise.resolve(writeFailure ? failure : { data: [{ id: "r1" }], error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));
vi.mock("@/lib/stripe", () => ({ stripe: {
  invoices: { retrieve: (...args: unknown[]) => invoiceRetrieve(...args) },
  billingPortal: { sessions: { create: (...args: unknown[]) => portalCreate(...args) } },
  customers: { list: (...args: unknown[]) => customerList(...args), create: (...args: unknown[]) => customerCreate(...args) },
  checkout: { sessions: {
    create: (...args: unknown[]) => sessionCreate(...args),
    list: (...args: unknown[]) => sessionList(...args),
    expire: (...args: unknown[]) => sessionExpire(...args),
  } },
  subscriptions: {
    list: (...args: unknown[]) => subscriptionList(...args),
    retrieve: (...args: unknown[]) => subscriptionRetrieve(...args),
    update: (...args: unknown[]) => subscriptionUpdate(...args),
  },
  prices: { create: (...args: unknown[]) => priceCreate(...args) },
  products: { create: (...args: unknown[]) => productCreate(...args) },
} }));
const { POST } = await import("@/app/api/billing/checkout/route");
const post = (plan = "casa") => POST(new NextRequest("https://tabletap.test/api/billing/checkout", {
  method: "POST", body: JSON.stringify({ plan }),
}));
const subscription = (id = "sub_1", status = "active") => ({
  id, status, customer: "cus_1", latest_invoice: "in_1", metadata: { restaurant_id: "r1", plan: "servicio" },
  items: { data: [{ id: "si_1", price: { id: "price_old", currency: "mxn" } }] },
});
beforeEach(() => {
  vi.resetAllMocks(); locked = false; writeFailure = false;
  saved = { state: {} };
  customerList.mockResolvedValue({ data: [], has_more: false });
  restaurant = { name: "Demo", currency: "USD", stripe_customer_id: "cus_1", stripe_subscription_id: null };
  rpc.mockImplementation(async (fn: string, args: { p_state?: object }) => {
    if (fn === "claim_restaurant_billing") {
      if (locked) return { data: false, error: null };
      locked = true;
    } else if (fn === "release_restaurant_billing") locked = false;
    else if (fn === "takeover_restaurant_billing") saved.state = args.p_state;
    else if (fn === "record_restaurant_billing") saved.state = { ...(saved.state as object), ...args.p_state };
    return { data: true, error: null };
  });
  customerCreate.mockResolvedValue({ id: "cus_1" });
  sessionCreate.mockResolvedValue({ id: "cs_new", url: "https://checkout/new" });
  sessionList.mockResolvedValue({ data: [], has_more: false });
  subscriptionList.mockResolvedValue({ data: [], has_more: false });
  subscriptionRetrieve.mockResolvedValue(subscription());
  subscriptionUpdate.mockResolvedValue(subscription());
  invoiceRetrieve.mockResolvedValue({ hosted_invoice_url: "https://invoice/pay" });
  portalCreate.mockResolvedValue({ url: "https://portal/pay" });
  priceCreate.mockResolvedValue({ id: "price_generated" });
  productCreate.mockResolvedValue({ id: "prod_casa" });
});
it("changes the existing subscription item instead of starting a second checkout", async () => {
  restaurant.stripe_subscription_id = "sub_1";
  subscriptionList.mockResolvedValue({ data: [subscription()], has_more: false });
  expect((await post()).status).toBe(200);
  expect(sessionCreate).not.toHaveBeenCalled();
  expect(subscriptionUpdate).toHaveBeenCalledWith("sub_1", expect.objectContaining({
    items: [expect.objectContaining({ id: "si_1", quantity: 1 })],
    metadata: { restaurant_id: "r1", plan: "casa" },
    payment_behavior: "error_if_incomplete", proration_behavior: "always_invoice",
  }), expect.anything());
});
it("reuses an open checkout for the requested plan", async () => {
  sessionList.mockResolvedValue({ data: [{ id: "cs_old", mode: "subscription", url: "https://checkout/old", metadata: { plan: "casa" } }], has_more: false });
  expect(await (await post()).json()).toEqual({ url: "https://checkout/old" });
  expect(sessionCreate).not.toHaveBeenCalled();
});
it("serializes concurrent first checkouts before creating a customer", async () => {
  restaurant.stripe_customer_id = null;
  const responses = await Promise.all([post(), post()]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect(customerCreate).toHaveBeenCalledTimes(1);
  expect(sessionCreate).toHaveBeenCalledTimes(1);
});
it("bills the MXN catalog amount even when the menu is in USD", async () => {
  await post("servicio");
  expect(priceCreate.mock.calls[0][0]).toMatchObject({ currency: "mxn", unit_amount: 69900 });
  expect(sessionCreate.mock.calls[0][0].line_items[0]).toMatchObject({ price: "price_generated" });
});
it("refuses duplicate live contracts instead of forgetting one", async () => {
  subscriptionList.mockResolvedValue({ data: [subscription(), subscription("sub_2")], has_more: false });
  expect((await post()).status).toBe(409);
  expect(sessionCreate).not.toHaveBeenCalled();
  expect(subscriptionUpdate).not.toHaveBeenCalled();
});
it("offers the existing first invoice instead of making a duplicate subscription", async () => {
  subscriptionList.mockResolvedValue({ data: [subscription("sub_1", "incomplete")], has_more: false });
  expect(await (await post()).json()).toEqual({ url: "https://invoice/pay" });
  expect(sessionCreate).not.toHaveBeenCalled();
});
it("keeps the lock after an unknown Stripe result so retry cannot create another checkout", async () => {
  sessionCreate.mockRejectedValue(new Error("connection lost"));
  expect((await post()).status).toBe(502);
  expect((await post()).status).toBe(409);
  expect(sessionCreate).toHaveBeenCalledTimes(1);
});
it("keeps the lock and stops checkout when saving the customer fails", async () => {
  restaurant.stripe_customer_id = null; writeFailure = true;
  expect((await post()).status).toBe(502);
  expect(locked).toBe(true);
  expect(sessionCreate).not.toHaveBeenCalled();
});
it("does not sync an upgrade Stripe refused to charge", async () => {
  subscriptionList.mockResolvedValue({ data: [subscription()], has_more: false });
  subscriptionUpdate.mockRejectedValue({ statusCode: 402 });
  expect((await post()).status).toBe(402);
  expect(sync).not.toHaveBeenCalled(); expect(locked).toBe(false);
});
it("finds a completed subscription even before its webhook linked it", async () => {
  subscriptionList.mockResolvedValue({ data: [subscription()], has_more: false });
  await post("servicio");
  expect(sync).toHaveBeenCalled();
  expect(subscriptionUpdate).not.toHaveBeenCalled(); expect(sessionCreate).not.toHaveBeenCalled();
});
it("expires a different pending plan before opening the chosen plan", async () => {
  sessionList.mockResolvedValue({ data: [{ id: "cs_old", mode: "subscription", url: "https://checkout/old", metadata: { plan: "servicio" } }], has_more: false });
  expect((await post()).status).toBe(200);
  expect(sessionExpire).toHaveBeenCalledWith("cs_old");
  expect(sessionExpire.mock.invocationCallOrder[0]).toBeLessThan(sessionCreate.mock.invocationCallOrder[0]);
});
it("finds subscriptions beyond the first Stripe page", async () => {
  subscriptionList.mockResolvedValueOnce({ data: [subscription("sub_old", "canceled")], has_more: true })
    .mockResolvedValueOnce({ data: [subscription()], has_more: false });
  await post("servicio");
  expect(subscriptionList).toHaveBeenLastCalledWith(expect.objectContaining({ starting_after: "sub_old" }));
  expect(sessionCreate).not.toHaveBeenCalled();
});
it("expires an older open checkout before changing the live contract", async () => {
  subscriptionList.mockResolvedValue({ data: [subscription()], has_more: false });
  sessionList.mockResolvedValue({ data: [{ id: "cs_old", mode: "subscription" }], has_more: false });
  await post();
  expect(sessionExpire).toHaveBeenCalledWith("cs_old");
  expect(sessionExpire.mock.invocationCallOrder[0]).toBeLessThan(subscriptionUpdate.mock.invocationCallOrder[0]);
});
it("recovers an expired empty claim and permits a new payment", async () => {
  locked = true;
  saved = { token: "old", started_at: new Date(Date.now() - 16 * 60000).toISOString(), state: {} };
  expect((await post()).status).toBe(200);
  expect(customerList).toHaveBeenCalled(); expect(sessionCreate).toHaveBeenCalledTimes(1);
});
it("recovers an unrecorded checkout instead of charging again", async () => {
  locked = true; restaurant.stripe_customer_id = null;
  saved = { token: "old", started_at: new Date(Date.now() - 16 * 60000).toISOString(), state: {} };
  customerList.mockResolvedValue({ data: [{ id: "cus_orphan", metadata: { restaurant_id: "r1" } }], has_more: false });
  sessionList.mockResolvedValue({ data: [{ id: "cs_old", mode: "subscription", url: "https://checkout/old", metadata: { plan: "casa" } }], has_more: false });
  expect(await (await post()).json()).toEqual({ url: "https://checkout/old" });
  expect(customerCreate).not.toHaveBeenCalled(); expect(sessionCreate).not.toHaveBeenCalled();
  expect(restaurant.stripe_customer_id).toBe("cus_orphan");
});
it("offers the billing portal when an unsettled contract has no invoice link", async () => {
  subscriptionList.mockResolvedValue({ data: [subscription("sub_1", "past_due")], has_more: false });
  invoiceRetrieve.mockResolvedValue({ hosted_invoice_url: null });
  expect(await (await post()).json()).toEqual({ url: "https://portal/pay" });
  expect(sessionCreate).not.toHaveBeenCalled();
});
