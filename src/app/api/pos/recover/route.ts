import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import type { PosSaleBody } from "@/lib/pos-sale";
import { ringOffline } from "@/lib/pos-offline";
import { compareOfflineSale } from "@/lib/offline-comparison";
import type { QueuedOfflineSale } from "@/lib/offline-review";

export const runtime = "nodejs";

/** Recover money already collected. Manager-only, audited, and available
 * after a tier ends; it does not reopen the till for new sales. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const posRef = req.nextUrl.searchParams.get("posRef");
  if (posRef) {
    const db = createAdminClient();
    const { data, error } = await db.from("offline_sale_queue")
      .select("pos_ref, body, collector, currency, submitted_by, reason, approved_by, approved_at")
      .eq("restaurant_id", actor.restaurantId).eq("pos_ref", posRef).maybeSingle();
    if (error) return await apiError("apiErr.generic", 503);
    if (!data) return await apiError("apiErr.notFound", 404);
    return NextResponse.json({ comparison: await compareOfflineSale(db, actor.restaurantId, data as QueuedOfflineSale) });
  }
  const history = req.nextUrl.searchParams.get("view") === "history";
  const page = req.nextUrl.searchParams.get("page") ?? "0";
  if (history && (!/^\d+$/.test(page) || Number(page) > 1_000_000)) return await apiError("apiErr.invalidRequest", 400);
  const query = () => createAdminClient().from("offline_sale_queue")
    .select("pos_ref, body, collector, currency, submitted_by, reason, approved_by, approved_at")
    .eq("restaurant_id", actor.restaurantId);
  if (history) {
    const size = 20;
    const from = Number(page) * size;
    const { data, error } = await query().not("approved_at", "is", null)
      .order("approved_at", { ascending: false }).order("pos_ref").range(from, from + size);
    if (error) return await apiError("apiErr.generic", 503);
    return NextResponse.json({ sales: (data ?? []).slice(0, size), hasMore: (data?.length ?? 0) > size });
  }
  try {
    const rows = await everyRow<QueuedOfflineSale>((a, b) => query().is("approved_at", null)
      .order("received_at", { ascending: false }).order("pos_ref").range(a, b), "held sales");
    return NextResponse.json({ sales: rows });
  } catch { return await apiError("apiErr.generic", 503); }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ posRef?: string; restaurantId?: string; approval?: {
    confirmed?: boolean; reason?: string; collector?: string; at?: string; currency?: string;
  } }>(req);
  if (!body || body.restaurantId !== actor.restaurantId || typeof body.posRef !== "string") return await apiError("apiErr.invalidRequest", 400);
  const a = body.approval;
  if (!a || a.confirmed !== true || typeof a.reason !== "string" || a.reason.trim().length < 8 || a.reason.length > 500
    || (a.collector !== undefined && (typeof a.collector !== "string" || a.collector.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.collector)))
    || (a.at !== undefined && typeof a.at !== "string") || (a.currency !== undefined && !["MXN", "USD"].includes(a.currency))) {
    return await apiError("apiErr.offlineRecoveryDetails", 400);
  }
  const { data: queued, error } = await createAdminClient().from("offline_sale_queue")
    .select("body, collector, currency").eq("restaurant_id", actor.restaurantId).eq("pos_ref", body.posRef).maybeSingle();
  if (error) return await apiError("apiErr.orderCreate", 503);
  if (!queued) return await apiError("apiErr.offlineQueueRequired", 409);
  if ((queued.collector && a.collector && queued.collector !== a.collector) || (queued.currency && a.currency && queued.currency !== a.currency)) {
    return await apiError("apiErr.offlineRecoveryDetails", 409);
  }
  return await ringOffline(actor, queued.body as PosSaleBody & { offline?: unknown }, {
    reason: a.reason.trim(), collector: queued.collector ?? a.collector, at: a.at, currency: queued.currency ?? a.currency,
  });
}
