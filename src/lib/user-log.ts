import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records who changed whose access.
 *
 * This is the restaurant's audit trail: an owner's activity log and a platform
 * admin's are the same rows in the same table, and the two routes that write
 * them each carried their own identical copy of this. Two copies of a rule
 * about who did what to whose account is one copy too many — add a field to
 * one and the log tells a different story depending on who made the change.
 */
export async function logUserChange(
  restaurantId: string,
  actorEmail: string,
  action: "created" | "updated" | "deleted",
  targetRole: string,
  targetEmail: string,
): Promise<void> {
  await createAdminClient().from("user_logs").insert({
    restaurant_id: restaurantId,
    actor_email: actorEmail,
    action,
    target_role: targetRole,
    target_email: targetEmail,
  });
}
