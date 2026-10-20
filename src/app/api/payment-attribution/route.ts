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
  const { data: p, error } = await db.from("payments").select("order_id, session_id, account_id, currency, allocation_origin")
    .eq("restaurant_id", actor.restaurantId).eq("id", id).eq("allocation_quality", "unresolved").maybeSingle();
  if (error) return await apiError("apiErr.verifyOrders", 503);
  if (!p) return await apiError("apiErr.orderNotFound", 404);
  const orders = await everyRow((a, b) => {
    let q = db.from("orders").select("id, total, tip, currency, status, customer_name, table_label, created_at")
      .eq("restaurant_id", actor.restaurantId);
    if (p.allocation_origin !== "legacy") q = q.eq("written_off", false).neq("status", "cancelled");
    if (p.currency) q = q.eq("currency", p.currency);
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
  const body = await jsonBody<{ paymentId?: string; currency?: string; evidence?: string; breakdownUnknown?: boolean; entries?: { orderId: string; amount: number; tip: number }[] }>(req);
  if (!body?.paymentId || typeof body.evidence !== "string" || body.evidence.trim().length < 8
    || (body.currency !== undefined && (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)))
    || (body.breakdownUnknown !== undefined && typeof body.breakdownUnknown !== "boolean") || !Array.isArray(body.entries) || !body.entries.length || body.entries.length > 100
    || body.entries.some(e => !e || typeof e.orderId !== "string" || !Number.isFinite(e.amount) || e.amount <= 0
      || !Number.isFinite(e.tip) || e.tip < 0 || e.tip > e.amount)) return await apiError("apiErr.invalidRequest", 400);
  const { data, error } = await createAdminClient().rpc("attribute_payment", {
    p_restaurant: actor.restaurantId, p_payment: body.paymentId, p_actor: actor.email, p_entries: body.entries, p_currency: body.currency ?? null,
    p_evidence: body.evidence.trim().slice(0, 500), p_breakdown_unknown: body.breakdownUnknown ?? false,
  });
  if (error || !data) return await apiError("apiErr.attributionChanged", 409);
  return NextResponse.json({ ok: true });
}
