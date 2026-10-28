import { expect, it } from "vitest";
import { billActions } from "@/lib/payment-options";
it("lets a waiter-opened bill use shared slots while whole-bill checkout stays with staff", () => {
  expect(billActions({ staffBill: true, cardsEnabled: true, splitAllowed: true }))
    .toMatchObject({ split: true, payOnline: false, extras: false, callWaiter: true });
});
