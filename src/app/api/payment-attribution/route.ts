import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const db = createAdminClient();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    const receipts = await everyRow((a, b) => db.from("payments")
      .select("id, amount, tip, method, actor_email, created_at, currency")
      .eq("restaurant_id", actor.restaurantId).eq("allocation_quality", "unresolved")
      .order("id").range(a, b), "the receipts needing attribution");
    return NextResponse.json({ receipts });
  }
  const { data: p, error } = await db.from("payments").select("order_id, session_id, account_id")
    .eq("restaurant_id", actor.restaurantId).eq("id", id).eq("allocation_quality", "unresolved").maybeSingle();
  if (error) return await apiError("apiErr.verifyOrders", 503);
  if (!p) return await apiError("apiErr.orderNotFound", 404);
  const orders = await everyRow((a, b) => {
    let q = db.from("orders").select("id, total, customer_name, table_label, created_at")
      .eq("restaurant_id", actor.restaurantId).eq("written_off", false).neq("status", "cancelled");
    if (p.order_id) q = q.eq("id", p.order_id);
    else if (p.account_id) q = q.eq("account_id", p.account_id);
    else if (p.session_id) q = q.eq("session_id", p.session_id).is("account_id", null);
    else q = q.eq("id", "00000000-0000-0000-0000-000000000000");
    return q.order("created_at").order("id").range(a, b);
  }, "the receipt's eligible orders");
  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ paymentId?: string; entries?: { orderId: string; amount: number; tip: number }[] }>(req);
  if (!body?.paymentId || !Array.isArray(body.entries) || !body.entries.length || body.entries.length > 100
    || body.entries.some(e => !e || typeof e.orderId !== "string" || !Number.isFinite(e.amount) || e.amount <= 0
      || !Number.isFinite(e.tip) || e.tip < 0 || e.tip > e.amount)) return await apiError("apiErr.invalidRequest", 400);
  const { data, error } = await createAdminClient().rpc("attribute_payment", {
    p_restaurant: actor.restaurantId, p_payment: body.paymentId, p_actor: actor.email, p_entries: body.entries,
  });
  if (error || !data) return await apiError("apiErr.attributionChanged", 409);
  return NextResponse.json({ ok: true });
}
