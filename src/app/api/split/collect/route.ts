import { tableOutstanding } from "@/lib/table-outstanding";
import { logSlotReceipt } from "@/lib/split-slots-activity";
import { type NextRequest, NextResponse } from "next/server";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { isDinerCurrency } from "@/lib/diner-currency";
import { closeSessionsFor } from "@/lib/table-session";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { readSlotSplit } from "@/lib/split-slots-access";
import { splitRpc, splitResponse } from "@/lib/split-slots-rpc";
import { splitCents, splitRevision, splitScope, splitSelection, splitUuid, type SplitScope } from "@/lib/split-slots";

export const runtime = "nodejs";
interface CollectionBody extends Partial<SplitScope> {
  splitId?: string; revision?: number; slots?: number[]; expectedCents?: number; currency?: string;
  tipCents?: number; method?: "cash" | "card"; ref?: string;
}
/** Pedidos and open bills use this one writer, including their lost-reply retries. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<CollectionBody>(req);
  if (!body || !splitScope(body) || !splitUuid(body.splitId) || !splitRevision(body.revision)
    || !splitSelection(body.slots) || !splitCents(body.expectedCents) || !body.expectedCents
    || !splitCents(body.tipCents ?? 0) || Number(body.tipCents ?? 0) > body.expectedCents
    || !isDinerCurrency(body.currency) || !["cash", "card"].includes(body.method ?? "")
    || typeof body.ref !== "string" || !body.ref.trim() || body.ref.length > 100) return await apiError("apiErr.invalidRequest", 400);
  if (actor.restaurantId !== body.restaurantId) return await apiError("apiErr.forbidden", 403);
  if (await isRoomLimited(req, "splitcollect", 30) || await isTableLimited(req, "splitcollect", body.tableId, 30)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }
  try {
    const split = await readSlotSplit(body, body.splitId);
    if (!split) return await splitResponse({ outcome: "gone" }, []);
    const before = await tableOutstanding(actor.restaurantId, body.tableId, body.currency);
    const result = await splitRpc("collect_split_slots_v1", {
      p_restaurant: actor.restaurantId, p_split: split.id, p_revision: body.revision, p_slots: body.slots,
      p_expected_cents: body.expectedCents, p_currency: body.currency, p_tip_cents: body.tipCents ?? 0,
      p_method: body.method, p_actor: actor.email, p_ref: body.ref.trim(),
    });
    if (["collected", "duplicate"].includes(result.outcome)) {
      await closeSessionsFor([{ session_id: body.sessionId }], "settled");
      const after = await tableOutstanding(actor.restaurantId, body.tableId, body.currency);
      const otherCurrencies = after.owed <= 0 ? await tableOutstanding(actor.restaurantId, body.tableId) : null;
      const settled = after.owed <= 0 && !(otherCurrencies?.balances?.some(b => b.owed > 0) ?? (otherCurrencies?.owed ?? 0) > 0);
      // The drawer reads this same activity as other table collections. Log
      // only new money: a lost-response retry must not count the cash twice.
      if (result.outcome === "collected") await logSlotReceipt(actor, result.payment ?? "",
        before.orders[0]?.table_label, after.owed, settled);
      return NextResponse.json({ ok: true, ...result, settled, owed: after.owed, currency: body.currency });
    }
    return await splitResponse(result, []);
  } catch { return await apiError("apiErr.collectionFailed", 503); }
}
