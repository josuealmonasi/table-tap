import { NextResponse } from "next/server";
import type { Actor } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { readOfflineContext } from "@/lib/offline-authority";
import { offlineCharge, offlineLines } from "@/lib/offline-sale";
import type { PosSaleBody } from "@/lib/pos-sale";
import { ringOffline } from "@/lib/pos-offline";

/** Receiving collected money is separate from allowing a new sale. A durable
 * queue entry lets the device sign out while a manager reviews the exception. */
export async function receiveOffline(actor: Actor, body: PosSaleBody & { offline?: unknown }, queueOnly = false): Promise<NextResponse> {
  if (body.method !== "cash" && body.method !== "card") return await apiError("apiErr.offlineMethod", 400);
  const original = body.offline as Record<string, unknown> | null;
  // Check the money separately from a wrong device clock. The original time
  // stays in the immutable receipt; only a manager can supply a corrected one.
  const charge = original && typeof original.at === "string" && original.at.length <= 80
    ? offlineCharge({ ...original, at: new Date().toISOString() }) : null;
  if (!charge || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.posRef ?? "")
    || !Array.isArray(body.items) || !body.items.length || body.items.length > 100
    || offlineLines(body.items).length !== body.items.length) {
    return await apiError("apiErr.offlineSale", 400, undefined, { held: true });
  }
  const db = createAdminClient();
  // A queued receipt is immutable. Always revisit it before attempting the
  // ordinary writer, even if the plan or menu has since changed back.
  const { data: queued, error } = await db.from("offline_sale_queue").select("pos_ref")
    .eq("restaurant_id", actor.restaurantId).eq("pos_ref", body.posRef!).maybeSingle();
  if (error) return await apiError("apiErr.orderCreate", 503, undefined, { held: true });
  const blocked = await frozenBlocks(actor.restaurantId) ?? await planBlocks(actor.restaurantId, "pos");
  let reason = "";
  if (!queueOnly && !queued && !blocked && offlineCharge(body.offline)) {
    const res = await ringOffline(actor, body);
    if (res.ok || res.status !== 409) return res;
    const data = await res.clone().json();
    if (!["apiErr.offlineCollector", "apiErr.offlineApproval", "recovery.currencyChanged", "apiErr.offlineCurrencyRequired"].includes(data.reviewReason)) return res;
    reason = data.reviewReason;
  } else if (blocked) reason = "recovery.planChanged";
  // Older receipts still have valid amounts. Their age is a review reason,
  // rather than a reason to leave collected money stranded on a tablet.
  if (!offlineCharge(body.offline)) reason = offlineCharge(body.offline, Date.now(), true)
    ? "apiErr.offlineTooOld" : "recovery.clockCheck";
  const context = readOfflineContext(body.collectorContext, actor.restaurantId);
  const { data, error: writeError } = await db.rpc("queue_offline_sale", {
    p_restaurant: actor.restaurantId, p_ref: body.posRef, p_body: body,
    p_collector: context?.collector ?? null, p_currency: context?.currency ?? (["MXN", "USD"].includes(String(body.currency)) ? body.currency : null),
    p_actor: actor.email, p_reason: reason || "apiErr.offlineApproval",
  });
  if (writeError || !data) return await apiError("apiErr.orderCreate", 503, undefined, { held: true });
  if (data.outcome === "conflict") return await apiError("apiErr.posMismatch", 409, undefined, { held: true });
  return NextResponse.json(data);
}
