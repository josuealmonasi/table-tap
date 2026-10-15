import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager } from "@/lib/api-guard";
import { costsBlocks } from "@/lib/costs/guard";
import { terminalFeePct } from "@/lib/costs/input";

export const runtime = "nodejs";

// PATCH /api/costs/settings — { terminalFeePct }: what the restaurant's own
// card terminal charges, as a share of the sale. Owner and managers, on a tier
// with costs. It only changes what the margins say; nobody is charged by it.
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const pct = terminalFeePct((await jsonBody<{ terminalFeePct?: unknown }>(req))?.terminalFeePct);
  if (pct === null) return await apiError("apiErr.terminalFee", 400);

  const { data, error } = await createAdminClient().from("restaurants")
    .update({ terminal_fee_pct: pct }).eq("id", actor.restaurantId).select("id");
  if (error) return await apiError("apiErr.generic", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "updated",
    detail: logDetail({ note: `${pct}%` }),
  });
  return NextResponse.json({ ok: true, terminalFeePct: pct });
}
