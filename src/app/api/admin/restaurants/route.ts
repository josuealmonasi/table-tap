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
    return await withRestaurantBilling(db, id, async operation => {
      const close = async (finalize: boolean) => {
        const { data, error } = await db.rpc("admin_close_restaurant_v1", {
          p_restaurant: id, p_token: operation.token, p_finalize: finalize,
        });
        if (error || !data) return await apiError("apiErr.restaurantDelete", 500);
        if (data.outcome === "gone" || data.outcome === (finalize ? "deleted" : "ready")) {
          invalidatePublicMenu(id);
          return null;
        }
        return await deletionRefusal(data);
      };
      const refused = await close(false);
      if (refused) return refused;
      await endRestaurantBilling(db, id, operation);
      const finalRefusal = await operation.write(() => close(true));
      if (finalRefusal) return finalRefusal;
      const { data: cleaned, error } = await db.rpc("admin_cleanup_restaurant_logins_v1", {
        p_restaurant: id, p_token: operation.token,
      });
      if (error || !cleaned) throw new Error(`Staff cleanup failed: ${error?.message ?? "claim lost"}`);
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return await billingFailure(err);
  }
}

async function deletionRefusal(data: { outcome: string; unlock_at?: unknown }): Promise<NextResponse> {
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
    accountsOwed: "apiErr.restaurantDeleteAccountsOwed",
    ordersOwed: "apiErr.restaurantDeleteOrdersOwed",
    billingBusy: "apiErr.billingBusy",
  };
  if (errors[data.outcome]) return await apiError(errors[data.outcome], 409);
  return await apiError("apiErr.restaurantDelete", 500);
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
