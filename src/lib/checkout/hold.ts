/**
 * What a checkout has taken and nobody else is yet responsible for.
 *
 * The coupon's use is claimed, then the stock, then the pending order is
 * written — and each refusal along the way gave back what it had by hand. An
 * error nobody expected (a dropped connection, a thrown query) went straight
 * to the catch-all, which gave back nothing: the use stayed spent and the
 * portions stayed sold to an order that never existed.
 *
 * `giveBack` runs at most once, whoever calls it, because handing a coupon's
 * use back twice lowers its count below what was really spent. `handOver` is
 * for the moment somebody else owns it: the kitchen, for an order that will be
 * paid at the table, or Stripe's expiry, for a card order with a session open.
 */
export interface CheckoutHold {
  /** Replace what would be given back with `undo`. */
  hold(undo: () => Promise<void>): void;
  /** Nothing is ours to give back any more. */
  handOver(): void;
  /** Give back what is held, once; later calls do nothing. */
  giveBack(): Promise<void>;
}

export function checkoutHold(): CheckoutHold {
  let undo: (() => Promise<void>) | null = null;
  return {
    hold(next) {
      undo = next;
    },
    handOver() {
      undo = null;
    },
    async giveBack() {
      const run = undo;
      undo = null;
      if (!run) return;
      try {
        await run();
      } catch (err) {
        // Said loudly and not thrown: the caller is already answering an
        // error, and a second one would replace the answer the diner needs.
        console.error("checkout could not give back what it held", err);
      }
    },
  };
}
