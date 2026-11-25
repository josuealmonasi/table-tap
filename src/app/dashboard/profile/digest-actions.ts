"use server";

import { getMember, MANAGES } from "@/lib/membership";
import { createAdminClient } from "@/lib/supabase/admin";

export async function saveDigestPreference(enabled: boolean): Promise<boolean> {
  if (typeof enabled !== "boolean") return false;
  const { user, membership } = await getMember();
  if (!user || !membership || !MANAGES(membership.role)) return false;
  const { data, error } = await createAdminClient().rpc("set_digest_preference_v1", {
    p_restaurant: membership.restaurant.id, p_user: user.id, p_enabled: enabled,
  });
  if (error) throw new Error("Could not save the digest preference", { cause: error });
  return data === true;
}
