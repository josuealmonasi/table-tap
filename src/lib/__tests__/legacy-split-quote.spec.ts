import { expect, it } from "vitest";
import type Stripe from "stripe";
import { legacySplitQuote } from "@/lib/legacy-split-checkout";
import { packOrderIds } from "@/lib/stripe-limits";

/** A split share page: MX$100 share + MX$40 add-on, MX$0 tip. */
const page = (ids: string[], amount = 14000, tip = "0") =>
  ({ amount_total: amount, metadata: { ...packOrderIds(ids), settle_tip: tip } }) as unknown as Stripe.Checkout.Session;

it("keeps a page for the same add-on orders, tip and total", () => {
  expect(legacySplitQuote(page(["a"]), 140, 0, ["a"])).toBe("same");
});

it("does not reopen a page for different add-on orders at the same price (review 1124)", () => {
  // The diner went back and chose another MX$40 order: the old page would settle the first one.
  expect(legacySplitQuote(page(["a"]), 140, 0, ["b"])).toBe("total");
  expect(legacySplitQuote(page(["a", "b"]), 140, 0, ["a"])).toBe("total");
  expect(legacySplitQuote(page(["b", "a"]), 140, 0, ["a", "b"])).toBe("same");
});

it("still reads tip and total first, and skips the order check when none is given", () => {
  expect(legacySplitQuote(page(["a"], 14000, "5"), 140, 0, ["a"])).toBe("tip");
  expect(legacySplitQuote(page(["a"], 15000), 140, 0, ["a"])).toBe("total");
  expect(legacySplitQuote(page(["a"]), 140, 0)).toBe("same");
});
