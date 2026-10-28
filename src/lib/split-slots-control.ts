import { type NextRequest, type NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { getPlan } from "@/lib/plan-server";
import { isDinerCurrency } from "@/lib/diner-currency";
import { isTableLimited } from "@/lib/rate-limit";
import { readSlotSplit, splitActor } from "@/lib/split-slots-access";
import { splitRpc, splitResponse } from "@/lib/split-slots-rpc";
import { splitCents, splitRevision, splitScope, splitUuid, type SplitScope } from "@/lib/split-slots";

interface ControlBody extends Partial<SplitScope> {
  splitId?: string; revision?: number; shares?: number; expectedCents?: number; currency?: string; ref?: string;
}
export async function controlSplit(req: NextRequest, action: "start" | "resize" | "cancel"): Promise<NextResponse> {
  const body = await jsonBody<ControlBody>(req);
  if (!body || !splitScope(body)) return await apiError("apiErr.invalidRequest", 400);
  if (await isTableLimited(req, `split-${action}`, body.tableId, 20)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }
  if (action !== "cancel" && (!Number.isInteger(body.shares) || Number(body.shares) < 2 || Number(body.shares) > 20)) {
    return await apiError("apiErr.splitPeople", 400);
  }
  try {
    const actor = await splitActor(req, body);
    if (!actor) return await apiError("apiErr.forbidden", 403);
    if (action === "start") {
      if (!splitUuid(body.ref) || !splitCents(body.expectedCents) || !isDinerCurrency(body.currency)) {
        return await apiError("apiErr.invalidRequest", 400);
      }
      const plan = await getPlan(body.restaurantId);
      // SQL caps this flat fee against the frozen food, excluding its unpaid tips.
      const flatFee = plan ? Math.round(plan.limits.order_fee * 100) : 0;
      return await splitResponse(await splitRpc("start_bill_split_v2", {
        p_restaurant: body.restaurantId, p_table: body.tableId, p_session: body.sessionId,
        p_member: actor.memberId, p_shares: body.shares, p_expected_cents: body.expectedCents,
        p_currency: body.currency, p_ref: body.ref, p_flat_fee_cents: flatFee,
      }), ["started", "repeat"]);
    }
    if (!splitUuid(body.splitId) || !splitRevision(body.revision)) return await apiError("apiErr.invalidRequest", 400);
    const split = await readSlotSplit(body, body.splitId);
    if (!split) return await splitResponse({ outcome: "gone" }, []);
    // Only its proposer can change another diner's quote. Staff can help any table.
    if (!actor.staff && split.proposed_by !== actor.memberId) return await apiError("apiErr.forbidden", 403);
    return await splitResponse(await splitRpc(`${action}_bill_split_v2`, {
      p_restaurant: body.restaurantId, p_split: body.splitId, p_revision: body.revision,
      p_actor: actor.actor, ...(action === "resize" ? { p_shares: body.shares } : {}),
    }), [action === "resize" ? "resized" : "cancelled"]);
  } catch { return await apiError("apiErr.verifyOrders", 503); }
}
