import { describe, expect, it } from "vitest";
import {
  MAX_ID_KEYS,
  packOrderIds,
  STRIPE_METADATA_VALUE_MAX,
  unpackOrderIds,
  MAX_CARD_CART_LINES,
  MAX_STRIPE_LINE_ITEMS,
  STRIPE_PRODUCT_NAME_MAX,
  stripeProductName,
} from "@/lib/stripe-limits";
import { MAX_BILL_ORDERS } from "@/lib/table-bill";

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `0000${String(i).padStart(4, "0")}-0000-4000-8000-000000000000`);

describe("a bill's order ids fit in Stripe's metadata", () => {
  it("keeps every value inside the 500-character limit", () => {
    // The limit Stripe documents as one that cannot be raised. A value over it
    // is not truncated: the whole session is refused, and the table is simply
    // unable to pay by card.
    for (const n of [1, 13, 14, 40, MAX_BILL_ORDERS]) {
      for (const [key, value] of Object.entries(packOrderIds(ids(n)))) {
        expect(value.length, `${key} for ${n} orders`).toBeLessThanOrEqual(STRIPE_METADATA_VALUE_MAX);
      }
    }
  });

  it("measures a real limit: the old single key really did overflow", () => {
    // Without this, every assertion above would pass on the broken code too.
    // This is the exact value the old routes built.
    expect(ids(13).join(",").length).toBeLessThanOrEqual(STRIPE_METADATA_VALUE_MAX);
    expect(ids(14).join(",").length).toBeGreaterThan(STRIPE_METADATA_VALUE_MAX);
    // And what we write instead fits.
    expect(Object.values(packOrderIds(ids(14))).every(v => v.length <= STRIPE_METADATA_VALUE_MAX)).toBe(true);
  });

  it("survives the table that broke it: fourteen orders", () => {
    // Thirteen fitted and fourteen did not, which is a table of twelve on its
    // second round.
    const packed = packOrderIds(ids(14));
    expect(unpackOrderIds(packed)).toEqual(ids(14));
  });

  it("round-trips a bill at the cap", () => {
    const packed = packOrderIds(ids(MAX_BILL_ORDERS));
    expect(Object.keys(packed).length).toBeLessThanOrEqual(MAX_ID_KEYS);
    expect(unpackOrderIds(packed)).toEqual(ids(MAX_BILL_ORDERS));
  });

  it("still writes the key the webhook routes on", () => {
    // `settleCheckout` decides a session is a bill settlement by looking for
    // this key. Renaming or dropping it sends the payment down another path.
    expect(packOrderIds(ids(1))).toHaveProperty("settle_order_ids");
    expect(packOrderIds([])).toHaveProperty("settle_order_ids", "");
  });

  it("reads a session written before this existed", () => {
    // Sessions created by the old code are still out there waiting to be paid,
    // carrying the whole list in the one key.
    const old = { settle_order_ids: ids(3).join(","), settle_tip: "20" };
    expect(unpackOrderIds(old)).toEqual(ids(3));
  });

  it("refuses rather than silently dropping ids", () => {
    // Half a bill marked paid and half left owed is worse than a refusal.
    expect(() => packOrderIds(ids(5000))).toThrow(/metadata keys/);
  });

  it("answers nothing for a session that carries no ids", () => {
    expect(unpackOrderIds(undefined)).toEqual([]);
    expect(unpackOrderIds({})).toEqual([]);
    expect(unpackOrderIds({ order_id: "x" })).toEqual([]);
  });
});

describe("a line's name fits what Stripe accepts", () => {
  it("leaves an ordinary dish alone", () => {
    expect(stripeProductName("🍔 Cheeseburger")).toBe("🍔 Cheeseburger");
  });

  it("trims one nobody could have meant", () => {
    // No column caps a dish name and the browser writes it directly, so this
    // is a manager's paste, not an attack — and it broke checkout for every
    // cart the dish was in.
    const long = stripeProductName("A".repeat(5000));
    expect(long.length).toBeLessThanOrEqual(STRIPE_PRODUCT_NAME_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("leaves room for the lines checkout adds after the dishes", () => {
    // Service charge and tip are line items too. A cart at the cap plus both
    // has to still be under Stripe's ceiling.
    expect(MAX_CARD_CART_LINES + 2).toBeLessThanOrEqual(MAX_STRIPE_LINE_ITEMS);
  });
});
