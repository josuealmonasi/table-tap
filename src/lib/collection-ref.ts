/**
 * A name for one collection, so a retry of it is not a second payment.
 *
 * The waiter is standing on a restaurant floor with a phone: the button gets
 * tapped twice because the first tap seemed to do nothing, or the request is
 * sent again when the signal comes back. The reference goes with every attempt
 * at the SAME collection and changes only once one has landed, so the database
 * can refuse the copy.
 *
 * `randomUUID` needs a secure context, which a phone on the restaurant's wifi
 * over plain http has not got. The fallback is not a UUID and does not need to
 * be — it only has to be unlikely to collide with another collection in the
 * same restaurant, and it is checked against nothing else.
 */
export function newRef(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
