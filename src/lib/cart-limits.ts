/** Why a cart can't be charged, as data — the caller supplies the wording. */
export type CartRejection =
  /** Quantities are whole portions from the cart, never a coerced amount. */
  | { kind: "invalidQuantity" }
  /** A dish (or a bundle) has gone off the menu since it was added. */
  | { kind: "unavailable"; name: string; itemId: string }
  /** More lines than any real order has. See `MAX_CART_LINES`. */
  | { kind: "tooManyLines"; limit: number }
  /** More distinct products than the lookup can ask about. See `MAX_CART_REFS`. */
  | { kind: "tooManyRefs"; limit: number }
  /** A required option group was never answered. */
  | { kind: "missingModifiers"; unanswered: string[]; forName: string; itemId: string }
  /** Extras vanished; the customer is asked to confirm before paying. */
  | { kind: "removedExtras"; ids: string[]; names: string[] };

/**
 * The most lines one order may carry.
 *
 * Nothing capped this, so a single request could create an order of ten
 * thousand lines: MX$115,500 on the board as one card, three and a half
 * seconds of server time to build, and a kitchen ticket queued for a thermal
 * printer that would still be spooling at closing time. No screen can produce
 * it — the cap is on the route, because the route is what somebody can call.
 *
 * Two hundred is far past any real table. A long party orders forty or fifty
 * lines; this is generous enough that nobody meets it by accident and small
 * enough that meeting it deliberately achieves nothing.
 */
export const MAX_CART_LINES = 200;

/**
 * More distinct products than a lookup can ask about in one go.
 *
 * PostgREST sends `.in(...)` as a URL, and a filter naming a thousand ids is
 * already a Bad Request — five thousand is a 414 from the proxy. The row fetch
 * then comes back empty and the cart is refused for the wrong reason: "could
 * not verify the items", when what happened is that we never managed to ask.
 */
export const MAX_CART_REFS = 500;

/**
 * The most lines one till sale may carry.
 *
 * A till sale is saved on the device before it is sent, and if the
 * connection drops it reaches the ledger later through offline intake, which
 * rings at most this many lines on its own. A larger cart could take the
 * money and then never land: replay refused it before the review queue, so
 * the receipt stayed on the tablet with nothing a manager could act on (bl39
 * finding 4). The till cart stops here, before any money is collected, and
 * intake checks the same number. Receipts already held with more go to
 * manager review.
 */
export const MAX_TILL_LINES = 100;
