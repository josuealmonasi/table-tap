import { beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/subscription-price", () => ({
  subscriptionPlan: async () => "servicio", registerSubscriptionPrice: async () => {},
}));
const customerCreate = vi.fn();
const customerList = vi.fn();
const sessionCreate = vi.fn();
const sessionList = vi.fn();
const sessionExpire = vi.fn();
const sessionLineItems = vi.fn();
const subscriptionList = vi.fn();
const subscriptionRetrieve = vi.fn();
const subscriptionUpdate = vi.fn();
const productCreate = vi.fn();
const priceCreate = vi.fn();
const invoiceRetrieve = vi.fn();
const portalCreate = vi.fn();
const sync = vi.fn();
const rpc = vi.fn();

const state = {
  saved: {} as Record<string, unknown>,
  locked: false,
  restaurant: {} as Record<string, unknown>,
  writeFailure: false,
  taken: 49,
};
const failure = { data: null, error: { message: "database unavailable" } };
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r1", email: "owner@test.com" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-server", () => ({ allPlans: async () => [
  { plan: "casa", monthly_price: 1499, list_price: 1899, stripe_price_id: null }, { plan: "servicio", monthly_price: 699 },
], foundersTaken: async () => state.taken }));
vi.mock("@/lib/subscription-sync", () => ({ applySubscription: (...args: unknown[]) => sync(...args) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (...args: unknown[]) => rpc(...args),
  from: (table: string) => {
    let patch: Record<string, unknown> | undefined;
    const q = {
      select: () => q, eq: () => q,
      update: (value: Record<string, unknown>) => { patch = value; return q; },
      single: async () => ({ data: state.restaurant, error: null }),
      maybeSingle: async () => ({ data: table === "restaurant_billing_operations" ? state.saved : state.restaurant, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (patch && !state.writeFailure) Object.assign(state.restaurant, patch);
        return Promise.resolve(state.writeFailure ? failure : { data: [{ id: "r1" }], error: null }).then(resolve);
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
    listLineItems: (...args: unknown[]) => sessionLineItems(...args),
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
const { GET } = await import("@/app/api/billing/assigned/route");
const ID = "6f1c2c1e-1111-4111-8111-111111111111";
const get = () => GET(new NextRequest(`https://tabletap.test/api/billing/assigned?plan=casa&a=${ID}`));
const post = (plan = "casa", founding = true) => POST(new NextRequest("https://tabletap.test/api/billing/checkout", {
  method: "POST", body: JSON.stringify({ plan, founding }),
}));
const openCheckout = (overrides: object = {}) => ({
  id: "cs_old", mode: "subscription", currency: "mxn", url: "https://checkout/old", metadata: { plan: "casa" }, ...overrides,
});
const lineItem = (price: string) => ({ quantity: 1, currency: "mxn", price: { id: price, recurring: { interval: "month" } } });
const assignFor = (minutes: number) => {
  const deadline = new Date(Date.now() + minutes * 60_000);
  Object.assign(state.restaurant, { plan: "casa", plan_status: "trialing", trial_ends_at: deadline.toISOString(), tier_assignment_id: ID });
  return Math.floor(deadline.getTime() / 1000);
};
const subscription = (id = "sub_1", status = "active") => ({
  id, status, customer: "cus_1", latest_invoice: "in_1", metadata: { restaurant_id: "r1", plan: "servicio" },
  items: { data: [{ id: "si_1", price: { id: "price_old", currency: "mxn" } }] },
});
beforeEach(() => {
  vi.resetAllMocks(); state.locked = false; state.writeFailure = false; state.taken = 49;
  state.saved = { state: {} };
  customerList.mockResolvedValue({ data: [], has_more: false });
  state.restaurant = { name: "Demo", currency: "USD", stripe_customer_id: "cus_1", stripe_subscription_id: null };
  rpc.mockImplementation(async (fn: string, args: { p_state?: object }) => {
    if (fn === "claim_restaurant_billing") {
      if (state.locked) return { data: false, error: null };
      state.locked = true;
    } else if (fn === "release_restaurant_billing") state.locked = false;
    else if (fn === "takeover_restaurant_billing") state.saved.state = args.p_state;
    else if (fn === "record_restaurant_billing") state.saved.state = { ...(state.saved.state as object), ...args.p_state };
    return { data: true, error: null };
  });
  customerCreate.mockResolvedValue({ id: "cus_1" });
  sessionCreate.mockResolvedValue({ id: "cs_new", url: "https://checkout/new" });
  sessionList.mockResolvedValue({ data: [], has_more: false });
  sessionLineItems.mockResolvedValue({ data: [lineItem("price_generated")], has_more: false });
  subscriptionList.mockResolvedValue({ data: [], has_more: false });
  subscriptionRetrieve.mockResolvedValue(subscription());
  subscriptionUpdate.mockResolvedValue(subscription());
  invoiceRetrieve.mockResolvedValue({ hosted_invoice_url: "https://invoice/pay" });
  portalCreate.mockResolvedValue({ url: "https://portal/pay" });
  priceCreate.mockResolvedValue({ id: "price_generated" });
  productCreate.mockResolvedValue({ id: "prod_casa" });
});

export {
  state, customerCreate, customerList, sessionCreate, sessionList, sessionExpire, sessionLineItems,
  subscriptionList, subscriptionUpdate, priceCreate, invoiceRetrieve, sync, get,
  post, openCheckout, lineItem, assignFor, subscription, ID,
};
