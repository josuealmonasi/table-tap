import { expect, it, vi } from "vitest";
import {
  state, customerCreate, customerList, sessionCreate, sessionList, sessionExpire, sessionLineItems,
  subscriptionList, subscriptionUpdate, priceCreate, invoiceRetrieve, sync, get,
  post, openCheckout, lineItem, assignFor, subscription, ID,
} from "./billing-checkout-fixture";

it("changes the existing subscription item instead of starting a second checkout", async () => {
  state.restaurant.stripe_subscription_id = "sub_1";
  subscriptionList.mockResolvedValue({ data: [subscription()], has_more: false });
  expect((await post()).status).toBe(200);
  expect(sessionCreate).not.toHaveBeenCalled();
  expect(subscriptionUpdate).toHaveBeenCalledWith("sub_1", expect.objectContaining({
    items: [expect.objectContaining({ id: "si_1", quantity: 1 })],
    metadata: { restaurant_id: "r1", plan: "casa" },
    payment_behavior: "error_if_incomplete", proration_behavior: "always_invoice",
  }), expect.anything());
});
it("reuses an open checkout with the same plan, currency and recurring Price", async () => {
  sessionList.mockResolvedValue({ data: [openCheckout()], has_more: false });
  expect(await (await post()).json()).toEqual({ url: "https://checkout/old" });
  expect(sessionLineItems).toHaveBeenCalledWith("cs_old", { limit: 1 });
  expect(sessionExpire).not.toHaveBeenCalled();
  expect(sessionCreate).not.toHaveBeenCalled();
});
it("expires a founding checkout before opening one at the confirmed regular price", async () => {
  state.taken = 50;
  sessionList.mockResolvedValue({ data: [openCheckout()], has_more: false });
  sessionLineItems.mockResolvedValue({ data: [lineItem("price_founding")], has_more: false });
  expect(await (await post("casa", false)).json()).toEqual({ url: "https://checkout/new" });
  expect(priceCreate).toHaveBeenCalledWith(expect.objectContaining({ unit_amount: 189900 }), expect.anything());
  expect(sessionCreate).toHaveBeenCalledWith(expect.objectContaining({ line_items: [{ price: "price_generated", quantity: 1 }] }), expect.anything());
  expect(sessionExpire).toHaveBeenCalledWith("cs_old");
  expect(sessionExpire.mock.invocationCallOrder[0]).toBeLessThan(sessionCreate.mock.invocationCallOrder[0]);
});
it("replaces an open checkout in a different currency even if it names the requested plan", async () => {
  sessionList.mockResolvedValue({ data: [openCheckout({ currency: "usd" })], has_more: false });
  expect(await (await post()).json()).toEqual({ url: "https://checkout/new" });
  expect(sessionExpire).toHaveBeenCalledWith("cs_old");
});
it.each([["emailed link", get], ["Plan screen", post]])(
  "binds checkout from the %s to its assignment and pay-by time", async (_entry, request) => {
    const deadline = assignFor(60);
    expect((await request()).status).toBe(request === get ? 303 : 200);
    const metadata = { restaurant_id: "r1", plan: "casa", tier_assignment_id: ID };
    expect(sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      expires_at: deadline, metadata, subscription_data: { metadata },
    }), expect.anything());
  },
);
it("caps assigned checkout at Stripe's 24-hour maximum when the deadline is farther away", async () => {
  assignFor(48 * 60);
  const before = Math.floor(Date.now() / 1000);
  expect((await get()).headers.get("location")).toBe("https://checkout/new");
  expect(sessionCreate.mock.calls[0][0].expires_at).toBeGreaterThanOrEqual(before + 86400);
  expect(sessionCreate.mock.calls[0][0].expires_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 86400);
});
it.each([["emailed link", get], ["Plan screen", post]])(
  "shows the pay-by refusal on the %s with less than 30 minutes left", async (_entry, request) => {
    assignFor(29);
    const res = await request();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apiErr.tierPayByTooSoon" });
    expect(sessionCreate).not.toHaveBeenCalled();
  },
);
it("releases the billing lock if just under 30 minutes remain after Stripe setup", async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    assignFor(31);
    state.restaurant.stripe_customer_id = null;
    customerCreate.mockImplementation(async () => {
      clock.mockReturnValue(now + 60_001);
      return { id: "cus_1" };
    });
    expect((await get()).status).toBe(409);
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(state.restaurant.stripe_customer_id).toBe("cus_1");
    expect(state.locked).toBe(false);
  } finally {
    clock.mockRestore();
  }
});
it.each(["wrong id", "missing id", "late expiry", "current assignment"])(
  "checks assignment identity and expiry before reusing checkout (%s)", async scenario => {
    const deadline = assignFor(60);
    const id = scenario === "wrong id" ? "other" : scenario === "missing id" ? undefined : ID;
    const expires_at = scenario === "late expiry" ? deadline + 1 : deadline;
    sessionList.mockResolvedValue({ data: [openCheckout({ metadata: { plan: "casa", tier_assignment_id: id }, expires_at })], has_more: false });
    const location = (await get()).headers.get("location");
    if (scenario === "current assignment") {
      expect(location).toBe("https://checkout/old");
      expect(sessionCreate).not.toHaveBeenCalled();
    } else {
      expect(location).toBe("https://checkout/new");
      expect(sessionExpire).toHaveBeenCalledWith("cs_old");
    }
  },
);
it("serializes concurrent first checkouts before creating a customer", async () => {
  state.restaurant.stripe_customer_id = null;
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
  state.restaurant.stripe_customer_id = null; state.writeFailure = true;
  expect((await post()).status).toBe(502);
  expect(state.locked).toBe(true);
  expect(sessionCreate).not.toHaveBeenCalled();
});
it("does not sync an upgrade Stripe refused to charge", async () => {
  subscriptionList.mockResolvedValue({ data: [subscription()], has_more: false });
  subscriptionUpdate.mockRejectedValue({ statusCode: 402 });
  expect((await post()).status).toBe(402);
  expect(sync).not.toHaveBeenCalled(); expect(state.locked).toBe(false);
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
  state.locked = true;
  state.saved = { token: "old", started_at: new Date(Date.now() - 16 * 60000).toISOString(), state: {} };
  expect((await post()).status).toBe(200);
  expect(customerList).toHaveBeenCalled(); expect(sessionCreate).toHaveBeenCalledTimes(1);
});
it("recovers an unrecorded checkout instead of charging again", async () => {
  state.locked = true; state.restaurant.stripe_customer_id = null;
  state.saved = { token: "old", started_at: new Date(Date.now() - 16 * 60000).toISOString(), state: {} };
  customerList.mockResolvedValue({ data: [{ id: "cus_orphan", metadata: { restaurant_id: "r1" } }], has_more: false });
  sessionList.mockResolvedValue({ data: [openCheckout()], has_more: false });
  expect(await (await post()).json()).toEqual({ url: "https://checkout/old" });
  expect(customerCreate).not.toHaveBeenCalled(); expect(sessionCreate).not.toHaveBeenCalled();
  expect(state.restaurant.stripe_customer_id).toBe("cus_orphan");
});
it("offers the billing portal when an unsettled contract has no invoice link", async () => {
  subscriptionList.mockResolvedValue({ data: [subscription("sub_1", "past_due")], has_more: false });
  invoiceRetrieve.mockResolvedValue({ hosted_invoice_url: null });
  expect(await (await post()).json()).toEqual({ url: "https://portal/pay" });
  expect(sessionCreate).not.toHaveBeenCalled();
});
