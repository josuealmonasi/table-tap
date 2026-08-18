import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { TERMS_VERSION } from "@/lib/legal";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/legal/accept — the owner accepts the current terms.
 *
 * Owner only: a manager runs the restaurant, but agreeing to a contract on its
 * behalf is not theirs to do. The version and the moment are both recorded,
 * along with who clicked — an acceptance nobody can identify later is not much
 * of an acceptance.
 */
export async function POST(): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { error } = await createAdminClient()
    .from("restaurants")
    .update({
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
      terms_accepted_email: actor.email,
    })
    .eq("id", actor.restaurantId);

  if (error) return await apiError("apiErr.generic", 500);
  return NextResponse.json({ ok: true });
}
