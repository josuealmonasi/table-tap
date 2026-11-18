import { invalidatePublicMenu } from "@/lib/public-menu-cache";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { TERMS_VERSION } from "@/lib/legal";
import { currentUser } from "@/lib/current-user";
import { TERMS_TEXT_HASH } from "@/lib/terms-evidence";
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
export async function POST(req: NextRequest): Promise<NextResponse> {
  void req;
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const user = await currentUser();
  if (!user) return await apiError("apiErr.forbidden", 403);

  const { error } = await createAdminClient().rpc("accept_terms_v1", {
    p_restaurant: actor.restaurantId,
    p_user: user.id,
    p_email: actor.email,
    p_version: TERMS_VERSION,
    p_text_hash: TERMS_TEXT_HASH,
  });
  invalidatePublicMenu(actor.restaurantId);

  if (error) return await apiError("apiErr.generic", 500);
  return NextResponse.json({ ok: true });
}
