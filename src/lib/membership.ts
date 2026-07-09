import type { SupabaseClient } from "@supabase/supabase-js";
import type { Restaurant } from "@/lib/types";

export type Role = "owner" | "staff";

export interface Membership {
  restaurant: Restaurant;
  role: Role;
}

/**
 * Resolves which restaurant the logged-in user belongs to: as its owner, or as
 * staff (via their membership row). Null when logged out or unaffiliated.
 * Used by the dashboard pages and layout — staff get the orders board only.
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
    .select("restaurant_id")
    .eq("user_id", user.id)
    .single();
  if (!membership) return null;

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", membership.restaurant_id)
    .single();
  return restaurant ? { restaurant: restaurant as Restaurant, role: "staff" } : null;
}
