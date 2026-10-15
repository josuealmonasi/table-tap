import { createAdminClient } from "@/lib/supabase/admin";
import { setupSteps, type SetupStep } from "@/lib/setup-steps";

/**
 * The setup steps for one restaurant, read with the secret key — the card
 * readiness and printer columns are server-only — and scoped to it. The
 * caller has already checked it is the owner asking.
 */
export async function restaurantSetup(restaurantId: string): Promise<SetupStep[]> {
  const db = createAdminClient();
  const head = { count: "exact" as const, head: true };
  const [dishes, tables, staff, restaurant] = await Promise.all([
    db.from("menu_items").select("id", head).eq("restaurant_id", restaurantId).eq("is_addon", false),
    db.from("restaurant_tables").select("id", head).eq("restaurant_id", restaurantId),
    db.from("staff").select("id", head).eq("restaurant_id", restaurantId),
    db.from("restaurants").select("stripe_charges_enabled, auto_print_kitchen, print_token").eq("id", restaurantId).maybeSingle(),
  ]);
  const r = restaurant.data;
  return setupSteps({
    hasDishes: (dishes.count ?? 0) > 0,
    hasTables: (tables.count ?? 0) > 0,
    takesCards: Boolean(r?.stripe_charges_enabled),
    prints: Boolean(r?.auto_print_kitchen || r?.print_token),
    hasTeam: (staff.count ?? 0) > 0,
  });
}
