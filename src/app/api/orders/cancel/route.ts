import { checkoutPageRpc } from "@/lib/checkout-page-rpc";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { actingManager } from "@/lib/api-guard";
import { summarise } from "@/lib/cancel-plan";
import { legacyStockDemand } from "@/lib/legacy-stock";
import { readCancel } from "@/lib/cancel-read";
import { executeOrderRefund, orderRefunds } from "@/lib/refunds/operations";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return await apiError("apiErr.invalidRequest", 400);
  const read = await readCancel(createAdminClient(), actor.restaurantId, id);
  if ("error" in read) return await apiError(read.error, read.status);
  const summary = summarise(read.order, read.plan);
  return NextResponse.json({ ...summary, pending: summary.refund + summary.cash + summary.terminal + summary.withTable > 0 });
}

/** The database commits cancellation and reserved refund capacity together.
 * Provider calls happen afterwards and can be safely resumed from Cuentas. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: string }>(req);
  if (!body?.id) return await apiError("apiErr.invalidRequest", 400);
  const db = createAdminClient();
  // An interrupted request may already have cancelled the order. Resume its
  // existing adjustment, rather than preparing a second obligation.
  const { data: prior, error: priorError } = await db.from("order_adjustments").select("id")
    .eq("restaurant_id", actor.restaurantId).eq("order_id", body.id).eq("kind", "cancel").maybeSingle();
  if (priorError) return await apiError("apiErr.verifyOrders", 503);
  let adjustmentId: string | undefined = prior?.id;
  if (!adjustmentId) {
    const read = await readCancel(db, actor.restaurantId, body.id);
    if ("error" in read) return await apiError(read.error, read.status);
    const { data, error } = await checkoutPageRpc("prepare_order_refund", {
      p_restaurant: actor.restaurantId, p_order: body.id, p_actor: actor.email,
      p_legacy_demand: await legacyStockDemand(actor.restaurantId, read.order),
      p_expected_paid: read.order.paid, p_expected_account: read.order.account_id ?? null,
      p_expected_hold: read.hold, p_expected_checkout: read.holdId,
    });
    if (error) return await apiError("apiErr.orderCancel", 503);
    if (data?.outcome === "paying") return await apiError(read.order.account_id ? "apiErr.accountPayingOnline" : "apiErr.accountBillPaying", 409);
    if (data?.outcome === "review") return await apiError("apiErr.attributionRequired", 409);
    if (data?.outcome !== "cancelled") return await apiError("apiErr.cancelChanged", 409);
    adjustmentId = data.adjustment;
  }
  const operations = await orderRefunds(actor.restaurantId, adjustmentId);
  for (const op of operations) {
    if (op.source === "stripe" && op.status !== "succeeded") {
      await executeOrderRefund(actor.restaurantId, op.id, actor.email)
        .catch(error => console.error("refund remains outstanding", op.id, error));
    }
  }
  return NextResponse.json({ ok: true, refundPending: (await orderRefunds(actor.restaurantId, adjustmentId)).some(o => o.status !== "succeeded") });
}
