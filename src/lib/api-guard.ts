import { getMember, MANAGES, type Role } from "@/lib/membership";
import type { Restaurant } from "@/lib/types";

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

/** One auth round trip: a route handler gets no `cache` memo, so asking twice paid twice. */
async function member(): Promise<{ actor: Actor; restaurant: Restaurant } | null> {
  const { user, membership } = await getMember();
  if (!membership) return null;
  return {
    actor: { restaurantId: membership.restaurant.id, role: membership.role, email: user?.email ?? "staff" },
    restaurant: membership.restaurant,
  };
}

async function resolve(): Promise<Actor | null> {
  return (await member())?.actor ?? null;
}

/** Any member of a restaurant — the floor and the kitchen included. */
export async function actingStaff(): Promise<Actor | null> {
  return await resolve();
}

/**
 * Anyone who handles the table's money in person: owner, manager, waiter.
 *
 * Not the kitchen. Marking a bill paid in cash, or writing one off, moves
 * money out of the takings without a payment processor anywhere near it —
 * that is a floor decision, and a kitchen login (often a shared screen on a
 * pass) is the last place it should be reachable from.
 */
export async function actingFrontOfHouse(): Promise<Actor | null> {
  const actor = await resolve();
  return actor && actor.role !== "kitchen" ? actor : null;
}

/** Owner or manager: menus, promotions, settings, refunds. */
export async function actingManager(): Promise<Actor | null> {
  const actor = await resolve();
  return actor && MANAGES(actor.role) ? actor : null;
}

/** A manager and their own restaurant's row, from the same single lookup. */
export async function actingManagerWithRestaurant(): Promise<{ actor: Actor; restaurant: Restaurant } | null> {
  const found = await member();
  return found && MANAGES(found.actor.role) ? found : null;
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
