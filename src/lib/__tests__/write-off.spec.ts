import { describe, expect, it } from "vitest";
import {
  isWriteOffReason,
  noteProblem,
  noteRequired,
  writableOff,
  writeOffTotal,
} from "@/lib/write-off";
import type { Order } from "@/lib/types";

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    total: 100,
    paid: false,
    written_off: false,
    status: "ready",
    ...over,
  } as Order;
}

describe("cancelling what a table owes", () => {
  it("only accepts a reason from the list", () => {
    expect(isWriteOffReason("walkout")).toBe(true);
    expect(isWriteOffReason("because")).toBe(false);
    expect(isWriteOffReason(null)).toBe(false);
  });

  it("insists on a note when the reason is 'other'", () => {
    // "Other" on its own explains nothing, and an unexplained write-off is
    // the thing this record exists to prevent.
    expect(noteRequired("other")).toBe(true);
    expect(noteProblem("other", "   ")).toBe("missing");
    expect(noteProblem("other", "table 6 dispute")).toBe(null);
  });

  it("lets the named reasons stand alone", () => {
    expect(noteRequired("walkout")).toBe(false);
    expect(noteProblem("walkout", "")).toBe(null);
  });

  it("refuses a note too long to read", () => {
    expect(noteProblem("walkout", "x".repeat(301))).toBe("tooLong");
    expect(noteProblem("walkout", "x".repeat(300))).toBe(null);
  });

  it("never cancels an order that was already paid for", () => {
    // Money that moved needs a refund, which is a different act with its own
    // record — cancelling it here would take it out of revenue with no trace.
    const orders = [order({ id: "a" }), order({ id: "b", paid: true })];
    expect(writableOff(orders).map(o => o.id)).toEqual(["a"]);
  });

  it("never cancels the same debt twice", () => {
    // Two managers on the same table would otherwise double what the reports
    // say the restaurant lost.
    const orders = [order({ id: "a" }), order({ id: "b", written_off: true })];
    expect(writableOff(orders).map(o => o.id)).toEqual(["a"]);
  });

  it("leaves out carts and cancelled orders", () => {
    const orders = [
      order({ id: "a" }),
      order({ id: "b", status: "pending_payment" }),
      order({ id: "c", status: "cancelled" }),
    ];
    expect(writableOff(orders).map(o => o.id)).toEqual(["a"]);
  });

  it("adds up what the restaurant is losing", () => {
    expect(writeOffTotal([order({ total: 18.36 }), order({ total: 4.2 })])).toBe(22.56);
  });

  it("rounds once, so the total matches the bill the diner saw", () => {
    expect(writeOffTotal([order({ total: 0.1 }), order({ total: 0.2 })])).toBe(0.3);
  });
});
