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
  allowPayLater: false,
  allowCounterPayment: false,
  atTable: true,
  acceptingOrders: true,
  ...over,
});

describe("lo que el comensal puede hacer", () => {
  it("con Stripe y pagar-al-final encendidos, ofrece las dos", () => {
    // This is what the restaurant asked for: pay for your own on sitting down, or
    // leave it open with the rest of the table.
    const o = paymentOptions(ctx({ cardsEnabled: true, allowPayLater: true }));
    expect(o.payNow).toBe(true);
    expect(o.payLater).toBe(true);
    expect(paymentHintKey(o)).toBe("cart.payNowHint");
  });

  it("con Stripe y pagar-al-final apagado, sólo tarjeta", () => {
    const o = paymentOptions(ctx({ cardsEnabled: true }));
    expect(o).toMatchObject({ payNow: true, payLater: false, payCounter: false });
    expect(paymentHintKey(o)).toBe("cart.securedBy");
  });

  it("sin Stripe no promete tarjeta por debajo del botón", () => {
    // The bug from the screenshot: the line said "pay now by card, or leave the
    // bill open" on a screen with no card button at all.
    const o = paymentOptions(ctx({ allowPayLater: true }));
    expect(o.payNow).toBe(false);
    expect(paymentHintKey(o)).not.toBe("cart.payNowHint");
    expect(paymentHintKey(o)).toBe("cart.payLaterOnlyHint");
  });

  it("dejar la cuenta abierta necesita una mesa", () => {
    // El QR general no tiene a quién cobrarle después.
    expect(paymentOptions(ctx({ allowPayLater: true, atTable: false })).payLater).toBe(false);
  });

  it("la caja es del QR general, no de la mesa", () => {
    expect(paymentOptions(ctx({ allowCounterPayment: true, atTable: true })).payCounter).toBe(false);
    expect(paymentOptions(ctx({ allowCounterPayment: true, atTable: false })).payCounter).toBe(true);
  });

  it("sin nada encendido y sin Stripe, no hay forma de ordenar", () => {
    // The second screenshot: the general QR with the cart in a dead end.
    const o = paymentOptions(ctx({ atTable: false }));
    expect(canOrder(o)).toBe(false);
    expect(paymentHintKey(o)).toBe("cart.noCardYet");
  });
});

describe("lo que hay que advertirle al dueño", () => {
  it("no advierte nada cuando el cobro con tarjeta funciona", () => {
    expect(ownerWarningKey(ctx({ cardsEnabled: true, allowPayLater: true }))).toBeNull();
  });

  it("avisa que sus clientes no pueden pagar en línea", () => {
    expect(ownerWarningKey(ctx({ allowPayLater: true }))).toBe("dash.noCardsConnected");
  });

  it("sube el tono cuando además apagó los dos interruptores", () => {
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
      ctx({ acceptingOrders: false, cardsEnabled: true, allowPayLater: true }),
    );
    expect(o).toMatchObject({ payNow: false, payLater: false, payCounter: false });
    expect(canOrder(o)).toBe(false);
  });

  it("says the kitchen has stopped, not that there is no card reader", () => {
    // The two send the diner to do different things: wait, or pay another way.
    const o = paymentOptions(ctx({ acceptingOrders: false, allowPayLater: true }));
    expect(paymentHintKey(o, false)).toBe("menu.closed");
    expect(paymentHintKey(o, false)).not.toBe("cart.noCardYet");
  });

  it("goes back to normal the moment orders are switched on", () => {
    const o = paymentOptions(ctx({ cardsEnabled: true, allowPayLater: true }));
    expect(paymentHintKey(o, true)).toBe("cart.payNowHint");
  });
});
