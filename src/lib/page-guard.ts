import { redirect } from "next/navigation";
import { getMembership, MANAGES, SETTLES, type Membership } from "@/lib/membership";

/**
 * Who may be on each dashboard screen, said once.
 *
 * It was written by hand across nine pages in two different shapes: some asked
 * for `currentUser()` and then the membership, others only the membership; some
 * mandaban a `/login` y otras a `/dashboard`. Ninguna estaba mal —todas
 * refused — but nine copies of a permission rule are nine places where the next
 * one gets written differently, and that is the exact shape of every bug in
 * this repo: two places that had to agree with nobody checking that they did.
 *
 * `currentUser()` was redundant: `getMembership()` already returns null with no session.
 *
 * Each returns the membership already checked, so the page carries on with
 * `membership.restaurant` without asking again — `getMembership` is cached per
 * request and costs no extra round trip.
 */

/** Session and restaurant. Without those there is no dashboard to show. */
export async function requireMembership(): Promise<Membership> {
  const membership = await getMembership();
  if (!membership) redirect("/login");
  return membership;
}

/** Menus, tables, promotions, settings, analytics: owner and manager. */
export async function requireManager(): Promise<Membership> {
  const membership = await requireMembership();
  if (!MANAGES(membership.role)) redirect("/dashboard/orders");
  return membership;
}

/** Collecting and seeing bills: the whole floor, nobody from the kitchen. */
export async function requireSettles(): Promise<Membership> {
  const membership = await requireMembership();
  if (!SETTLES(membership.role)) redirect("/dashboard/orders");
  return membership;
}

/** Team logins and the subscription: the owner's and nobody else's. */
export async function requireOwner(): Promise<Membership> {
  const membership = await requireMembership();
  if (membership.role !== "owner") redirect("/dashboard");
  return membership;
}
