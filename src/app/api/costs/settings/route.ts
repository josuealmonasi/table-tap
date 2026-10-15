import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager } from "@/lib/api-guard";
import { costsBlocks } from "@/lib/costs/guard";
import { coverDays, terminalFeePct } from "@/lib/costs/input";

export const runtime = "nodejs";

// PATCH /api/costs/settings — { terminalFeePct?, purchaseCoverDays? }: what
// the restaurant's own card terminal charges, as a share of the sale, and how
// many days of use the purchase list buys for. Owner and managers, on a tier
// with costs. They only change what the screen suggests; nobody is charged.
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const body = await jsonBody<{ terminalFeePct?: unknown; purchaseCoverDays?: unknown }>(req);
  const change: { terminal_fee_pct?: number; purchase_cover_days?: number } = {};
  if (body?.terminalFeePct !== undefined || body?.purchaseCoverDays === undefined) {
    const pct = terminalFeePct(body?.terminalFeePct);
    if (pct === null) return await apiError("apiErr.terminalFee", 400);
    change.terminal_fee_pct = pct;
  }
  if (body?.purchaseCoverDays !== undefined) {
    const days = coverDays(body.purchaseCoverDays);
    if (days === null) return await apiError("apiErr.coverDays", 400);
    change.purchase_cover_days = days;
  }

  const { data, error } = await createAdminClient().from("restaurants")
    .update(change).eq("id", actor.restaurantId).select("id");
  if (error) return await apiError("apiErr.generic", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "updated",
    detail: logDetail({
      note: [change.terminal_fee_pct !== undefined && `${change.terminal_fee_pct}%`,
        change.purchase_cover_days !== undefined && `${change.purchase_cover_days} d`].filter(Boolean).join(" · "),
    }),
  });
  return NextResponse.json({ ok: true });
}
