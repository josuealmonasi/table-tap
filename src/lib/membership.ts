import type { SupabaseClient } from "@supabase/supabase-js";
import type { Restaurant } from "@/lib/types";

export type Role = "owner" | "manager" | "kitchen";

export interface Membership {
  restaurant: Restaurant;
  role: Role;
}

/**
 * Resolves which restaurant the logged-in user belongs to and as what: the
 * owner, a manager (menus/tables/orders), or kitchen (orders board only).
 * Null when logged out or unaffiliated.
 */
export async function getMembership(supabase: SupabaseClient): Promise<Membership | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: owned } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user.id)
    .single();
  if (owned) return { restaurant: owned as Restaurant, role: "owner" };

  const { data: membership } = await supabase
    .from("staff")
    .select("restaurant_id, role")
    .eq("user_id", user.id)
    .single();
  if (!membership) return null;

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", membership.restaurant_id)
    .single();
  if (!restaurant) return null;
  return {
    restaurant: restaurant as Restaurant,
    role: membership.role === "manager" ? "manager" : "kitchen",
  };
}
