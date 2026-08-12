import { currentUser } from "@/lib/current-user";
import { getMembership, MANAGES, type Role } from "@/lib/membership";

/**
 * Who is calling a route, and which restaurant they are confined to.
 *
 * Every write in this app must be scoped to `restaurantId` — that scope is
 * the only thing standing between two tenants once a route reaches for the
 * secret key, which bypasses RLS. Routes used to each derive it their own way
 * (four different shapes, two of which re-queried `restaurants` and `staff`
 * by hand), and a route that derives its own security boundary is a route
 * that can get it subtly wrong.
 */
export interface Actor {
  restaurantId: string;
  role: Role;
  /** Recorded in the activity log; the fallback only shows if a token has no email. */
  email: string;
}

async function resolve(): Promise<Actor | null> {
  const membership = await getMembership();
  if (!membership) return null;
  const user = await currentUser();
  return {
    restaurantId: membership.restaurant.id,
    role: membership.role,
    email: user?.email ?? "staff",
  };
}

/** Any member of a restaurant — the floor and the kitchen included. */
export async function actingStaff(): Promise<Actor | null> {
  return await resolve();
}

/** Owner or manager: menus, promotions, settings, refunds. */
export async function actingManager(): Promise<Actor | null> {
  const actor = await resolve();
  return actor && MANAGES(actor.role) ? actor : null;
}

/**
 * Owner only — founding owner or co-owner, which `getMembership` already
 * collapses into the same role. Used where the decision is the owner's alone:
 * staff logins and connecting a bank account.
 */
export async function actingOwner(): Promise<Actor | null> {
  const actor = await resolve();
  return actor?.role === "owner" ? actor : null;
}
