import { describe, expect, it } from "vitest";
import { creditFor } from "@/lib/table-outstanding";

const paid = (amount: number, tip = 0) => ({ order_id: null, session: "s1", amount, tip });

/**
 * How much of a sitting's money is still available to pay for what is left.
 *
 * The arithmetic behind the one bug an attack probe found rather than a test:
 * a table that paid MX$200 and then ordered MX$60 more read as owing nothing,
 * because the MX$200 it had already handed over was counted a second time
 * against the new round.
 */
describe("money on a sitting that has not been spent yet", () => {
  it("is all of it while nothing has been settled", () => {
    expect(creditFor([paid(115, 15)], [], new Map())).toBe(115);
  });

  it("is none of it once it has closed the orders it paid for", () => {
    // MX$215 collected, MX$215 of food closed with it. The next round starts
    // from nothing, which is the whole point.
    expect(creditFor([paid(215, 15)], [{ id: "a", total: 215 }], new Map())).toBe(0);
  });

  it("is the surplus when more was taken than the orders came to", () => {
    expect(creditFor([paid(215)], [{ id: "a", total: 200 }], new Map())).toBe(15);
  });

  it("ignores an order that paid for itself", () => {
    // A card at the table settles one order with its own payment, so the
    // waiter's MX$30 of cash is still there for whatever is left.
    expect(
      creditFor([paid(30)], [{ id: "a", total: 100 }], new Map([["a", 100]])),
    ).toBe(30);
  });

  it("counts what an order's own payment did not cover", () => {
    // Half by card, half out of the sitting's cash: only the other half of the
    // cash is left.
    expect(
      creditFor([paid(80)], [{ id: "a", total: 100 }], new Map([["a", 60]])),
    ).toBe(40);
  });

  it("never goes below nothing", () => {
    expect(creditFor([], [{ id: "a", total: 100 }], new Map())).toBe(0);
    expect(creditFor([paid(10)], [{ id: "a", total: 100 }], new Map())).toBe(0);
  });
});
