import type { CartRejection } from "@/lib/verify-cart";

/**
 * The sentence a cart rejection deserves, as an i18n key and its variables.
 *
 * `verifyCart` returns why a cart can't be charged as data, on purpose — but
 * three routes then have to turn that data into words, and only two of them
 * did. The waiter's route answered `{ rejection }` with no message at all, so
 * every refusal it made — a sold-out dish, an unanswered option group — landed
 * on the screen as "network error" while the network was fine. The wording
 * lives here so a fourth caller cannot repeat that.
 */
export function rejectionMessage(r: CartRejection): {
  key: string;
  vars: Record<string, string | number>;
} {
  switch (r.kind) {
    case "unavailable":
      // Without a name — an id that was never on this menu — the sentence has
      // to stand on its own rather than naming a blank.
      return r.name
        ? { key: "apiErr.itemGone", vars: { name: r.name } }
        : { key: "apiErr.itemGoneUnnamed", vars: {} };
    case "tooManyLines":
      return { key: "apiErr.tooManyLines", vars: { n: r.limit } };
    case "missingModifiers":
      return {
        key: "apiErr.chooseFirst",
        vars: { options: r.unanswered.join(", "), name: r.forName },
      };
    case "removedExtras":
      return { key: "apiErr.extrasGone", vars: { names: r.names.join(", ") } };
  }
}
