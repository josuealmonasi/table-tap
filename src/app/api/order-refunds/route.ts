import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeOrderRefund, orderRefunds } from "@/lib/refunds/operations";
import { attributeReturn } from "@/lib/refunds/attribution";
import { prepareReturn, type ReturnRequest } from "@/lib/refunds/prepare";

export async function GET(): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  try { return NextResponse.json({ refunds: await orderRefunds(actor.restaurantId) }); }
  catch { return await apiError("apiErr.verifyOrders", 503); }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<ReturnRequest & { id?: string; confirmReturned?: boolean; drawer?: "original" | "me"; refundId?: string }>(req);
  try {
    if (body?.dueId !== undefined) return await apiError("apiErr.duplicateRefundUseDue", 409);
    if (body?.action === "attribute") return await attributeReturn(body, actor);
    if (body?.action === "prepare") return await prepareReturn(body, actor);
    if (body?.action !== undefined) return await apiError("apiErr.invalidRequest", 400);
    if (!body?.id) return await apiError("apiErr.invalidRequest", 400);
    const db = createAdminClient();
    const { data: operation, error } = await db.from("refund_operations")
      .select("id, source, original_collector").eq("id", body.id).eq("restaurant_id", actor.restaurantId).maybeSingle();
    if (error) return await apiError("apiErr.verifyOrders", 503);
    if (!operation) return await apiError("apiErr.orderNotFound", 404);
    if (operation.source === "review") return await apiError("apiErr.refundReviewRequired", 409);
    if (operation.source === "stripe") {
      return NextResponse.json({ ok: true, completed: await executeOrderRefund(actor.restaurantId, operation.id, actor.email) });
    }
    if (body.confirmReturned !== true || !["original", "me"].includes(body.drawer ?? "")) {
      return await apiError("apiErr.invalidRequest", 400);
    }
    const payout = body.drawer === "original" ? operation.original_collector : actor.email;
    if (!payout) return await apiError("apiErr.refundReviewRequired", 409);
    const { data, error: writeError } = await db.rpc("finish_refund_operation_v2", {
      p_restaurant: actor.restaurantId, p_operation: operation.id, p_actor: actor.email,
      p_refunds: [], p_status: "succeeded", p_payout: payout,
    });
    if (writeError || data?.outcome !== "completed") return await apiError("apiErr.refundFailed", 503);
    return NextResponse.json({ ok: true, completed: true });
  } catch { return await apiError("apiErr.verifyOrders", 503); }
}
