import { describe, expect, it } from "vitest";
import {
  canOrder,
  ownerWarningKey,
  paymentHintKey,
  paymentOptions,
  type PaymentContext,
} from "@/lib/payment-options";

const ctx = (over: Partial<PaymentContext> = {}): PaymentContext => ({
  cardsEnabled: false,
  allowDeferred: false,
  atTable: true,
  acceptingOrders: true,
  ...over,
});

describe("what the diner is able to do", () => {
  it("offers both when Stripe and pay-at-the-end are on", () => {
    // This is what the restaurant asked for: pay for your own on sitting down, or
    // leave it open with the rest of the table.
    const o = paymentOptions(ctx({ cardsEnabled: true, allowDeferred: true }));
    expect(o.payNow).toBe(true);
    expect(o.payLater).toBe(true);
    expect(paymentHintKey(o)).toBe("cart.payNowHint");
  });

  it("offers card only when pay-at-the-end is off", () => {
    const o = paymentOptions(ctx({ cardsEnabled: true }));
    expect(o).toMatchObject({ payNow: true, payLater: false, payCounter: false });
    expect(paymentHintKey(o)).toBe("cart.securedBy");
  });

  it("promises no card under the button when there is no Stripe", () => {
    // The bug from the screenshot: the line said "pay now by card, or leave the
    // bill open" on a screen with no card button at all.
    const o = paymentOptions(ctx({ allowDeferred: true }));
    expect(o.payNow).toBe(false);
    expect(paymentHintKey(o)).not.toBe("cart.payNowHint");
    expect(paymentHintKey(o)).toBe("cart.payLaterOnlyHint");
  });

  it("is one switch: an open bill at a table, the counter on the general QR", () => {
    // The one that shipped: the general QR was handed a cart with no button on
    // it — no card connected, and the counter option unreachable — while the
    // owner's screen showed "pay at the end" switched on. One switch, and which
    // of the two offers it becomes is decided by the QR, never by the owner.
    const table = paymentOptions(ctx({ allowDeferred: true, atTable: true }));
    expect(table).toMatchObject({ payLater: true, payCounter: false });

    const general = paymentOptions(ctx({ allowDeferred: true, atTable: false }));
    expect(general).toMatchObject({ payLater: false, payCounter: true });
    expect(canOrder(general)).toBe(true);
    expect(paymentHintKey(general)).toBe("cart.counterOnlyHint");
  });

  it("leaves no way to order with nothing switched on and no Stripe", () => {
    // The second screenshot: the general QR with the cart in a dead end.
    const o = paymentOptions(ctx({ atTable: false }));
    expect(canOrder(o)).toBe(false);
    expect(paymentHintKey(o)).toBe("cart.noCardYet");
  });
});

describe("what the owner has to be warned about", () => {
  it("warns about nothing while taking cards works", () => {
    expect(ownerWarningKey(ctx({ cardsEnabled: true, allowDeferred: true }))).toBeNull();
  });

  it("says their customers cannot pay online", () => {
    expect(ownerWarningKey(ctx({ allowDeferred: true }))).toBe("dash.noCardsConnected");
  });

  it("raises its voice when they switched the other one off too", () => {
    // At that point it is not one option fewer: it is that nobody can order.
    expect(ownerWarningKey(ctx())).toBe("dash.noPaymentAtAll");
  });
});

describe("orders paused", () => {
  it("offers nothing at all, whichever way they could have paid", () => {
    // Checkout answers 409 while orders are off, so every button is a refusal
    // waiting to happen. The cart used to keep a dead "order and pay at the
    // end" button with the caption still telling them to order now.
    const o = paymentOptions(
      ctx({ acceptingOrders: false, cardsEnabled: true, allowDeferred: true }),
    );
    expect(o).toMatchObject({ payNow: false, payLater: false, payCounter: false });
    expect(canOrder(o)).toBe(false);
  });

  it("says the kitchen has stopped, not that there is no card reader", () => {
    // The two send the diner to do different things: wait, or pay another way.
    const o = paymentOptions(ctx({ acceptingOrders: false, allowDeferred: true }));
    expect(paymentHintKey(o, false)).toBe("menu.closed");
    expect(paymentHintKey(o, false)).not.toBe("cart.noCardYet");
  });

  it("goes back to normal the moment orders are switched on", () => {
    const o = paymentOptions(ctx({ cardsEnabled: true, allowDeferred: true }));
    expect(paymentHintKey(o, true)).toBe("cart.payNowHint");
  });
});
