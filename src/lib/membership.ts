import { cache } from "react";
import { currentUser } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/server";
import type { Restaurant } from "@/lib/types";

export type Role = "owner" | "manager" | "waiter" | "kitchen";

/** Owner + manager run the business (money, settings). Waiter + kitchen are floor/back staff. */
export const MANAGES = (role: Role): boolean => role === "owner" || role === "manager";

/**
 * Who may take a payment at the table or write a debt off: everyone on the
 * floor, and nobody in the kitchen. It moves money out of the takings without
 * a processor involved, so it stays with the people who carry the card
 * machine — the API enforces the same rule.
 */
export const SETTLES = (role: Role): boolean => role !== "kitchen";

/**
 * Who may move a ticket between kitchen stages.
 *
 * Waiters run the floor, not the pass: they mark an order completed when they
 * hand it over, but starting and finishing the cooking is the kitchen's call.
 * Letting the floor drag tickets backwards would lose the kitchen's own record
 * of what it is working on.
 */
export const MOVES_ORDERS = (role: Role): boolean => role !== "waiter";

export interface Membership {
  restaurant: Restaurant;
  role: Role;
}

/** A staff row with its restaurant pulled in by the same query. */
interface StaffRow {
  role: string;
  restaurant: Restaurant | null;
}

/**
 * Resolves which restaurant the logged-in user belongs to and as what: the
 * owner, a manager (menus/tables/orders), waiter, or kitchen (orders board
 * only). Null when logged out or unaffiliated.
 *
 * The two ways of belonging — founding owner via `restaurants.owner_id`, or a
 * `staff` row — are independent, so they are asked in parallel and the staff
 * side embeds its restaurant rather than fetching it afterwards. This used to
 * be three sequential queries where the first was a guaranteed miss for every
 * non-owner.
 *
 * Cached per request: the layout renders a navbar from this and the page
 * guards on it, and they should not each pay for the lookup.
 *
 * Still runs on the user-scoped client, so RLS applies exactly as before —
 * this is a round-trip change, not a permission change.
 */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const user = await currentUser();
  if (!user) return null;

  const supabase = await createClient();
  const [ownedRes, staffRes] = await Promise.all([
    supabase.from("restaurants").select("*").eq("owner_id", user.id).maybeSingle(),
    supabase
      .from("staff")
      .select("role, restaurant:restaurants(*)")
      .eq("user_id", user.id)
      .maybeSingle<StaffRow>(),
  ]);

  if (ownedRes.data) return { restaurant: ownedRes.data as Restaurant, role: "owner" };

  const staff = staffRes.data;
  if (!staff?.restaurant) return null;
  // Co-owners (staff role 'owner') get the full owner experience; other roles
  // map through directly. An unrecognised role falls back to the least
  // privileged one rather than being trusted.
  const known: Role[] = ["owner", "manager", "waiter", "kitchen"];
  const role: Role = known.includes(staff.role as Role) ? (staff.role as Role) : "kitchen";
  return { restaurant: staff.restaurant, role };
});
