import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import type { Actor } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { refundEvidence, returnCharge, uuid, verifiedRefund } from "./return-provider";

/** A manager names the refund; its financial facts come only from Stripe. */
export async function attributeReturn(body: { id?: unknown; refundId?: unknown; ref?: unknown }, actor: Actor): Promise<NextResponse> {
  if (!uuid(body.id) || !uuid(body.ref) || typeof body.refundId !== "string" || !/^re_[a-zA-Z0-9]+$/.test(body.refundId)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const operation = await returnCharge(actor.restaurantId, body.id);
  if (!operation) return await apiError("apiErr.orderNotFound", 404);
  if (operation.source !== "stripe") return await apiError("apiErr.refundReviewRequired", 409);
  const refund = await stripe.refunds.retrieve(body.refundId, { stripeAccount: operation.stripe_account_id });
  if (!verifiedRefund(refund, operation) || refund.status !== "succeeded"
    || refund.metadata?.refund_due || refund.metadata?.refund_attempt
    || refund.metadata?.refund_operation && refund.metadata.refund_operation !== operation.id) {
    return await apiError("apiErr.refundReviewRequired", 409);
  }
  const { data, error } = await createAdminClient().rpc("record_order_return_coverage_v1", {
    p_restaurant: actor.restaurantId, p_operation: operation.id, p_actor: actor.email,
    p_attribution_ref: body.ref, p_refunds: [refundEvidence(refund, operation)],
  });
  if (error || !data) return await apiError("apiErr.verifyOrders", 503);
  if (!["completed", "partial"].includes(data.outcome)) return await apiError("apiErr.refundReviewRequired", 409);
  return NextResponse.json({ ok: true, completed: data.outcome === "completed", outstandingCents: data.outstanding_cents });
}
