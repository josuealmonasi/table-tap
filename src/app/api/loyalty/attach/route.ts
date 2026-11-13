import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { getPlan } from "@/lib/plan-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loyaltyOn } from "@/lib/loyalty/server";
import { normalizeCode } from "@/lib/loyalty/code";
import { attachmentErrors } from "@/lib/loyalty/attachment";
import { cardEmailFor } from "@/lib/loyalty/card-email";
import { attachmentAccess, attachmentRow, cardForSale, receiptCard, type AttachmentTarget } from "@/lib/loyalty/attachment-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function enabled(restaurantId: string): Promise<boolean> {
  const plan = await getPlan(restaurantId);
  return loyaltyOn(restaurantId, plan?.limits ?? null);
}

/** Current attachment and availability; no complete bearer code leaves a bill. */
export async function GET(req: NextRequest) {
  if (await isRoomLimited(req, "loyalty-attach-read", 120)) return await apiError("apiErr.tooManyRequests", 429);
  try {
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const access = await attachmentAccess(req, { ...params, preview: params.preview === "true" });
    if (!access) return await apiError("apiErr.forbidden", 403);
    if (!(await enabled(access.restaurantId))) return NextResponse.json({ enabled: false, card: null });
    if (params.preview === "true") return NextResponse.json({ enabled: true, card: null });
    if (!access.orderId && !access.sessionId) return NextResponse.json({ enabled: false, card: null });
    const row = await attachmentRow(access);
    const open = row && !row.paid && !row.closed_at && row.status !== "cancelled";
    const card = open && row.loyalty_card_id ? await receiptCard(access.restaurantId, row.loyalty_card_id) : null;
    // Where this sale's ticket will be emailed: masked for the floor, whole
    // for owner and manager, nothing for a diner's phone at the table.
    const email = card && access.staff ? await cardEmailFor(access.restaurantId, card.cardId ?? "", access.fullEmail) : null;
    return NextResponse.json({ enabled: Boolean(open), card: card ? { suffix: card.suffix, progress: card.progress, goal: card.goal, email } : null });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}

/** Code possession proves card ownership; the table cookie proves sitting ownership. */
export async function POST(req: NextRequest) {
  if (await isRoomLimited(req, "loyalty-attach", 30)) return await apiError("apiErr.tooManyRequests", 429);
  const body = await jsonBody<AttachmentTarget & { code?: unknown; remove?: unknown; currentCode?: unknown }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  if (await isTableLimited(req, "loyalty-attach", typeof body.tableId === "string" ? body.tableId : null, 30)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }
  try {
    const access = await attachmentAccess(req, body);
    if (!access) return await apiError("apiErr.forbidden", 403);
    const code = typeof body.code === "string" ? normalizeCode(body.code) : null;
    if (!code && !(body.remove === true && access.staff)) return await apiError("rewards.invalid", 400);
    if (!(await enabled(access.restaurantId))) return await apiError("loyaltyAttach.off", 409);
    const db = createAdminClient();
    if (body.preview === true) {
      const id = code ? await cardForSale(access.restaurantId, code) : null;
      if (!id) return await apiError("loyaltyAttach.unknown", 404);
      const card = await receiptCard(access.restaurantId, id);
      if (!card) return await apiError("loyaltyAttach.unknown", 404);
      return NextResponse.json({ outcome: "attached", card: card ? { suffix: card.suffix, progress: card.progress, goal: card.goal } : null });
    }
    if (!access.orderId && !access.sessionId) return await apiError("loyaltyAttach.gone", 404);
    const row = await attachmentRow(access);
    if (!row || row.closed_at || row.status === "cancelled") return await apiError("loyaltyAttach.gone", 404);
    if (row.paid) return await apiError("loyaltyAttach.paid", 409);
    if (body.remove === true) {
      // Conditional writes keep a concurrent payment/closure from being edited.
      let query = access.orderId
        ? db.from("orders").update({ loyalty_card_id: null }).eq("id", access.orderId).eq("paid", false).neq("status", "cancelled")
        : db.from("table_sessions").update({ loyalty_card_id: null }).eq("id", access.sessionId!).is("closed_at", null);
      if (!access.staff) {
        const own = await cardForSale(access.restaurantId, code!);
        if (!own) return await apiError("loyaltyAttach.unknown", 404);
        query = query.eq("loyalty_card_id", own);
      }
      const { data, error } = await query.eq("restaurant_id", access.restaurantId).select("id").maybeSingle();
      if (error) return await apiError("apiErr.generic", 503);
      if (!data) return await apiError("loyaltyAttach.gone", 404);
      return NextResponse.json({ outcome: "removed", card: null });
    }
    // A diner replaces a different card only with that card's code, the same
    // proof removing it takes (review access1); staff replace it freely.
    const { data, error } = await db.rpc("attach_loyalty_card_v2", {
      p_restaurant: access.restaurantId, p_code: code, p_order: access.orderId,
      p_session: access.sessionId, p_actor: access.actor, p_staff: access.staff,
      p_current_code: typeof body.currentCode === "string" ? normalizeCode(body.currentCode) : null,
    });
    if (error || !data) return await apiError("apiErr.generic", 503);
    if (data.outcome !== "attached") {
      const refusal = attachmentErrors[data.outcome as keyof typeof attachmentErrors];
      return refusal ? await apiError(refusal.key, refusal.status, undefined, { outcome: data.outcome })
        : await apiError("apiErr.generic", 503);
    }
    return NextResponse.json({ outcome: "attached", card: { suffix: code!.slice(-4), progress: data.progress, goal: data.goal } });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
