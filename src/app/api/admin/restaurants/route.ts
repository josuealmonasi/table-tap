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
// everything under it (menus, orders, tables, staff rows cascade via FK).
// The founding owner's LOGIN survives; delete it separately if wanted.
export async function DELETE(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<Record<string, unknown>>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id } = body;
  if (typeof id !== "string" || !id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  try {
    return await withRestaurantBilling(db, id, async operation => {
      // Keep the IDs and staff until Stripe confirms nothing can charge.
      // Scheduling cancellation is still a live contract until its paid end.
      await endRestaurantBilling(db, id, operation);
      // Staff logins would be orphaned auth users once their rows cascade — remove
      // the logins themselves first.
      const { data: members, error: staffError } = await db.from("staff").select("user_id").eq("restaurant_id", id);
      if (staffError) throw new Error(`Staff lookup failed: ${staffError.message}`);
      for (const m of members ?? []) {
        const { error } = await db.auth.admin.deleteUser(m.user_id);
        if (error) throw new Error(`Staff deletion failed: ${error.message}`);
      }
      const { error } = await operation.write(async () => await db.from("restaurants").delete().eq("id", id));
      if (error) return await apiError("apiErr.restaurantDelete", 500);
      await operation.record({ deleted: true });
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
export async function PATCH(req: NextRequest) {
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
