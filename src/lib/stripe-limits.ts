/**
 * The limits Stripe refuses on, and what we do to stay inside them.
 *
 * Each one is a hard limit from Stripe's own documentation, each one is
 * reachable by an ordinary busy restaurant, and each one fails the same way:
 * the API rejects the request, the route's catch turns it into "checkout
 * failed", and the diner taps again to the same result. No money is ever at
 * risk — none can move — but the bill cannot be paid by card at all.
 *
 * ── The order ids on a settlement ────────────────────────────────────────
 *
 * The id of every order a payment settles rides on the Checkout Session, so
 * the webhook marks exactly those rows paid and nothing that arrived after.
 * It was written as one comma-joined string — and a metadata VALUE stops at
 * 500 characters, which Stripe documents as a limit that cannot be raised. A
 * uuid and its comma is 37 of them, so thirteen orders fit and the fourteenth
 * does not. A table of twelve that ordered a second round is fourteen orders.
 *
 * Over the limit, Stripe rejects the session outright: the route's catch turns
 * that into "checkout failed", the diner taps again, and it fails again. No
 * money is at risk — none can move — but the bill cannot be paid by card at
 * all, on exactly the busy table most likely to want to split it.
 *
 * So the list is written across as many keys as it needs. The first keeps its
 * original name, which matters more than it looks: sessions created before
 * this shipped are still out there waiting to be paid, and they carry the old
 * single key. Reading starts with it either way.
 */

/** Stripe: "value: 500 character limit". Documented as unraisable. */
export const STRIPE_METADATA_VALUE_MAX = 500;

/** Stripe: 50 key-value pairs per object, and the rest of the settle keys need some. */
export const MAX_ID_KEYS = 20;

const FIRST_KEY = "settle_order_ids";

const keyFor = (n: number): string => (n === 0 ? FIRST_KEY : `${FIRST_KEY}_${n + 1}`);

/**
 * The order ids as metadata, split across keys so no value exceeds the limit.
 *
 * Throws rather than truncating if the list cannot fit at all: silently
 * dropping ids would mark part of a bill paid and leave the rest owed, which
 * is the one outcome worse than refusing.
 */
export function packOrderIds(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let key = 0;
  let current: string[] = [];
  let length = 0;

  for (const id of ids) {
    const added = length === 0 ? id.length : length + 1 + id.length;
    if (added > STRIPE_METADATA_VALUE_MAX) {
      out[keyFor(key++)] = current.join(",");
      current = [id];
      length = id.length;
    } else {
      current.push(id);
      length = added;
    }
  }
  if (current.length > 0) out[keyFor(key++)] = current.join(",");
  // An empty list still writes the first key, so the webhook's "is this a bill
  // settlement?" test reads the same as it always did.
  if (key === 0) out[FIRST_KEY] = "";

  if (key > MAX_ID_KEYS) {
    throw new Error(`A bill of ${ids.length} orders needs ${key} metadata keys; the most is ${MAX_ID_KEYS}`);
  }
  return out;
}

/** What Stripe hands back on a session: a flat string map. */
type Metadata = Record<string, string | undefined>;

/** The ids back out, first key first, stopping at the first key that isn't there. */
export function unpackOrderIds(metadata: Metadata | null | undefined): string[] {
  const ids: string[] = [];
  for (let n = 0; n < MAX_ID_KEYS; n++) {
    const chunk = metadata?.[keyFor(n)];
    if (chunk == null) break;
    for (const id of chunk.split(",")) {
      const trimmed = id.trim();
      if (trimmed) ids.push(trimmed);
    }
  }
  return ids;
}

/**
 * Stripe Checkout takes at most 100 line items in one session.
 *
 * The diner's checkout emits one per cart line, plus the service charge and
 * the tip — so the real ceiling on a card order is two fewer than this. The
 * cart cap of MAX_CART_LINES is for the routes that never reach Stripe: a
 * waiter's ticket and a till sale are written straight to the database.
 */
export const MAX_STRIPE_LINE_ITEMS = 100;

/** Room for the two lines checkout adds after the dishes. */
export const MAX_CARD_CART_LINES = MAX_STRIPE_LINE_ITEMS - 2;

/** Stripe: "The `name` field on product endpoints has a maximum of 250." */
export const STRIPE_PRODUCT_NAME_MAX = 250;

/**
 * A line's name, trimmed to what Stripe will accept.
 *
 * Dishes are written straight from the browser under RLS, and no column caps
 * the name — so a manager who pastes a paragraph into one makes every cart
 * containing that dish unpayable, with nothing on any screen to say why. The
 * receipt is worse for the truncation; it is not worse than not existing.
 */
export function stripeProductName(name: string): string {
  return name.length <= STRIPE_PRODUCT_NAME_MAX
    ? name
    : `${name.slice(0, STRIPE_PRODUCT_NAME_MAX - 1).trimEnd()}…`;
}
