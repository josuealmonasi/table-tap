import { can, type PlanLimits } from "@/lib/plan";

/** A restaurant with no readable plan has no plan permissions. */
const NO_PLAN = { allows_deferred_payment: false } as PlanLimits;

/**
 * Whether a checkout may send the food now and leave the bill open.
 *
 * An unpaid order only leaves here if something holds it, and that is always
 * decided from the database, never from what the client says:
 *
 *   - at a table, the table holds it: the bill stays open and the waiter
 *     collects at the end, if the owner allows it;
 *   - on the general QR there is no table to come back to, so what holds it
 *     is the counter: the customer goes to the till, pays and collects.
 *
 * Without one of those two, anyone claiming `payLater` would walk off with
 * food nobody can charge for. Both come from the one switch the owner has:
 * which of them applies is decided by the QR, not by the restaurant.
 *
 * It also comes with the plan, and is asked here rather than only when the
 * switch is flipped: someone downgrading to Carta keeps the switch on in
 * the database, and without this would go on giving away orders with no
 * fee on the free plan.
 */
export function payLaterAllowed(allowPayLater: unknown, limits: PlanLimits | undefined): boolean {
  return Boolean(allowPayLater) && can(limits ?? NO_PLAN, "deferredPayment");
}
