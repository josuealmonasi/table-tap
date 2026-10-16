import { describe, expect, it } from "vitest";
import { feeCounts, type FeeRow } from "@/lib/fee-month";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const row = (over: Partial<FeeRow>): FeeRow => ({
  platform_fee: 3, paid: true, status: "completed", created_at: ago(120), card_checkout_at: null, ...over,
});

// The fee is written on the order before the diner pays. The ceiling used to
// count every order carrying one, so an abandoned checkout and a cancelled,
// refunded sale each brought the month's ceiling early.
describe("which fees count toward the month's ceiling", () => {
  it("counts a fee we took", () => {
    expect(feeCounts(row({}), NOW)).toBe(true);
    expect(feeCounts(row({ status: "received" }), NOW)).toBe(true);
  });

  it("does not count a sale cancelled after it was paid: its fee went back with the refund", () => {
    expect(feeCounts(row({ status: "cancelled" }), NOW)).toBe(false);
  });

  it("does not count a checkout nobody paid, once Stripe's session is over", () => {
    expect(feeCounts(row({ paid: false, status: "pending_payment", created_at: ago(36) }), NOW)).toBe(false);
    expect(feeCounts(row({ paid: false, status: "pending_payment", created_at: ago(60 * 24 * 3) }), NOW)).toBe(false);
  });

  it("counts a checkout still open, so two diners at once never both fit under one ceiling", () => {
    expect(feeCounts(row({ paid: false, status: "pending_payment", created_at: ago(5) }), NOW)).toBe(true);
    // A table's bill reopened at Stripe: the latest checkout is what is open.
    expect(feeCounts(row({ paid: false, status: "pending_payment", created_at: ago(300), card_checkout_at: ago(10) }), NOW)).toBe(true);
  });

  it("does not count an unpaid order that is not waiting on a checkout", () => {
    expect(feeCounts(row({ paid: false, status: "received", created_at: ago(5) }), NOW)).toBe(false);
  });
});
