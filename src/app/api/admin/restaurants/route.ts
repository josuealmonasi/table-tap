import { invalidatePublicMenu } from "@/lib/public-menu-cache";
import { auditedAdminAction, type AdminAuditContext } from "@/lib/admin-audit";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignTier, TIER_BILLING, type TierBilling } from "@/lib/admin-tier";
import { siteOrigin } from "@/lib/site-origin";
import { billingFailure, withRestaurantBilling } from "@/lib/billing-operation";
import { endRestaurantBilling } from "@/lib/billing-delete";
import { getLocale } from "@/lib/i18n/server";
import { dateLocale } from "@/lib/format";

export const runtime = "nodejs";

// DELETE /api/admin/restaurants — a platform admin erases a restaurant and
// its live data only when no payment or refund is outstanding. The locked RPC
// retains accounting copies first; menus, tables and staff then cascade via FK.
// The founding owner's LOGIN survives; delete it separately if wanted.
async function deleteRestaurant(_req: NextRequest, { body }: AdminAuditContext) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

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
      if (data.outcome === "refundWindow") {
        const unlock = typeof data.unlock_at === "string" ? new Date(data.unlock_at) : null;
        if (!unlock || !Number.isFinite(unlock.getTime())) return await apiError("apiErr.restaurantDelete", 500);
        const date = new Intl.DateTimeFormat(dateLocale(await getLocale()), {
          year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
          timeZone: "UTC", timeZoneName: "short",
        }).format(unlock);
        return await apiError("apiErr.restaurantDeleteRefundWindow", 409, { date }, { unlock_at: data.unlock_at });
      }
      const errors: Record<string, string> = {
        refund: "apiErr.restaurantDeleteRefund", refundDue: "apiErr.restaurantDeleteRefundDue",
        provider: "apiErr.restaurantDeleteProvider",
        dispute: "disputes.deleteBlocked",
        offlineSale: "apiErr.restaurantDeleteOfflineSale", refundFee: "apiErr.restaurantDeleteRefundFee",
        refundFeeVerification: "apiErr.restaurantDeleteRefundFeeVerification",
      };
      if (errors[data.outcome]) return await apiError(errors[data.outcome], 409);
      if (!checkOnly && ["deleted", "gone"].includes(data.outcome)) invalidatePublicMenu(id);
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

// PATCH /api/admin/restaurants — a platform admin assigns a restaurant a
// tier. Body: { id, plan, billing?, payBy? }. Its whole team moves with it:
// the plan belongs to the restaurant. `billing` says how it is paid
// (`assignTier`): from the next Stripe invoice, by a payment link the owner
// gets by email, or free. Without it, free — the move this route always made.
async function movePlan(req: NextRequest, { body }: AdminAuditContext) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

  if (!body || typeof body.id !== "string" || typeof body.plan !== "string") {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const billing = (body.billing ?? "free") as TierBilling;
  if (!TIER_BILLING.includes(billing)) return await apiError("apiErr.invalidRequest", 400);

  const answer = await assignTier(createAdminClient(), {
    restaurantId: body.id, plan: body.plan, billing, payBy: body.payBy, origin: siteOrigin(req),
  }, admin.email);
  if (!answer.ok) return await apiError(answer.error, answer.status);
  return NextResponse.json(answer);
}

export const DELETE = auditedAdminAction("restaurant.delete", deleteRestaurant);
export const PATCH = auditedAdminAction("restaurant.plan", movePlan);
