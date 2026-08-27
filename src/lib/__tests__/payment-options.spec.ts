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
  ...over,
});

describe("lo que el comensal puede hacer", () => {
  it("con Stripe y pagar-al-final encendidos, ofrece las dos", () => {
    // Es lo que el restaurante pidió: pagar lo suyo al sentarse, o dejarlo
    // abierto con el resto de la mesa.
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
    // El defecto de la captura: el renglón decía "Paga ahora con tarjeta, o
    // deja la cuenta abierta" en una pantalla sin ningún botón de tarjeta.
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
    // La segunda captura: el QR general con el carrito en un callejón.
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
    // Ahí ya no es una opción de menos: es que nadie puede ordenar.
    expect(ownerWarningKey(ctx())).toBe("dash.noPaymentAtAll");
  });
});
