import { auditedAdminAction } from "@/lib/admin-audit";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { moveRestaurantPlan } from "@/lib/admin-plan";
import { billingFailure, withRestaurantBilling } from "@/lib/billing-operation";
import { endRestaurantBilling } from "@/lib/billing-delete";

export const runtime = "nodejs";

// DELETE /api/admin/restaurants — a platform admin erases a restaurant and
// its live data only when no payment or refund is outstanding. The locked RPC
// retains accounting copies first; menus, tables and staff then cascade via FK.
// The founding owner's LOGIN survives; delete it separately if wanted.
async function deleteRestaurant(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<Record<string, unknown>>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id } = body;
  if (typeof id !== "string" || !id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  try {
    // Check before touching Stripe or a login, then check and delete atomically
    // under the same money lock as refunds. The second check catches races.
    const remove = async (checkOnly: boolean) => {
      const { data, error } = await db.rpc("admin_delete_restaurant", {
        p_restaurant: id, p_check_only: checkOnly,
      });
      if (error || !data) return await apiError("apiErr.restaurantDelete", 500);
      const errors: Record<string, string> = {
        refund: "apiErr.restaurantDeleteRefund", refundDue: "apiErr.restaurantDeleteRefundDue",
        provider: "apiErr.restaurantDeleteProvider",
        offlineSale: "apiErr.restaurantDeleteOfflineSale", refundFee: "apiErr.restaurantDeleteRefundFee",
      };
      if (errors[data.outcome]) return await apiError(errors[data.outcome], 409);
      if (!["ready", "deleted", "gone"].includes(data.outcome)) return await apiError("apiErr.restaurantDelete", 500);
      return null;
    };
    const refused = await remove(true);
    if (refused) return refused;
    return await withRestaurantBilling(db, id, async operation => {
      // Keep the IDs and staff until Stripe confirms nothing can charge.
      // Scheduling cancellation is still a live contract until its paid end.
      await endRestaurantBilling(db, id, operation);
      // Staff logins would be orphaned auth users once their rows cascade — keep
      // their IDs first, and remove the logins only after the guarded delete.
      // A refusal must never take away the staff who can finish a refund.
      const { data: members, error: staffError } = await db.from("staff").select("user_id").eq("restaurant_id", id);
      if (staffError) throw new Error(`Staff lookup failed: ${staffError.message}`);
      const { data: saved, error: savedError } = await db.from("restaurant_billing_operations")
        .select("state").eq("restaurant_id", id).maybeSingle();
      if (savedError) throw new Error(`Staff recovery lookup failed: ${savedError.message}`);
      const previous: unknown = saved?.state?.staff_ids;
      const staffIds = [...new Set([
        ...(Array.isArray(previous) ? previous.filter((id): id is string => typeof id === "string") : []),
        ...(members ?? []).map(m => m.user_id as string),
      ])];
      // Keep the cleanup list outside the cascade so a lost response or failed
      // Auth deletion can be retried after the restaurant has disappeared.
      await operation.record({ staff_ids: staffIds });
      const refused = await operation.write(() => remove(false));
      if (refused) return refused;
      for (const userId of staffIds) {
        const { error } = await db.auth.admin.deleteUser(userId);
        if (error?.status === 404) continue; // A previous attempt already removed it.
        if (error) throw new Error(`Staff deletion failed: ${error.message}`);
      }
      await operation.record({ deleted: true, staff_ids: [] });
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return await billingFailure(err);
  }
}

// PATCH /api/admin/restaurants — a platform admin moves a restaurant to
// another plan. Body: { id, plan }. Its whole team moves with it: the plan
// belongs to the restaurant. Refused for one still billed by a live Stripe
// subscription (`moveRestaurantPlan`).
async function movePlan(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ id?: unknown; plan?: unknown }>(req);
  if (!body || typeof body.id !== "string" || typeof body.plan !== "string") {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const answer = await moveRestaurantPlan(createAdminClient(), body.id, body.plan, admin.email);
  if (!answer.ok) return await apiError(answer.error, answer.status);
  return NextResponse.json({ ok: true, from: answer.from, to: answer.to });
}

export const DELETE = auditedAdminAction("restaurant.delete", deleteRestaurant);
export const PATCH = auditedAdminAction("restaurant.plan", movePlan);
