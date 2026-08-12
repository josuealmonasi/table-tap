import { cache } from "react";
import { currentUser } from "@/lib/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PlatformAdmin {
  userId: string;
  email: string;
}

/**
 * The logged-in user as a platform admin, or null. The platform_admins table
 * has no client policies, so the check always runs with the secret key —
 * a client can't fake or even see admin status.
 */
export const getPlatformAdmin = cache(async (): Promise<PlatformAdmin | null> => {
  const user = await currentUser();
  if (!user) return null;

  const { data } = await createAdminClient()
    .from("platform_admins")
    .select("user_id, email")
    .eq("user_id", user.id)
    .single();
  return data ? { userId: data.user_id, email: data.email } : null;
});
