import { createAdminClient } from "@/lib/supabase/admin";

/** The currency the restaurant charges in today: the only one its costs count in. */
export async function chargedCurrency(restaurantId: string): Promise<string> {
  const { data, error } = await createAdminClient().from("restaurants").select("currency").eq("id", restaurantId).single();
  if (error || !data) throw new Error(`Could not read the restaurant's currency: ${error?.message}`);
  return data.currency as string;
}
