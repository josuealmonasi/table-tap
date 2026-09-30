import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { jsonBody } from "@/lib/json-body";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { accountById } from "@/lib/accounts-server";
import { chargeAccount, chargeRefusal, currencyOf } from "@/lib/account-charge";

export const runtime = "nodejs";

// POST /api/accounts/charge — "ponlo en mi cuenta": a bill's orders go onto a
// customer's account. The waiter or cashier pressing it is the approval, and
// the log says who, for which account and for how much.
//
// Body: { accountId, orderIds, expected } — `expected` is the total the person
// was shown, so a bill that grew since is refused rather than charged unseen.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const blocked = await planBlocks(actor.restaurantId, "openAccounts");
  if (blocked) return blocked;

  const body = await jsonBody<{ accountId?: unknown; orderIds?: unknown; expected?: unknown }>(req);
  const orderIds = Array.isArray(body?.orderIds) ? body.orderIds.filter(id => typeof id === "string") : [];
  const expected = Number(body?.expected);
  if (!body || typeof body.accountId !== "string" || orderIds.length === 0 || orderIds.length > 60 ||
      !Number.isFinite(expected) || expected <= 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const account = await accountById(actor.restaurantId, body.accountId);
  if (!account) return await apiError("apiErr.notFound", 404);

  const result = await chargeAccount(actor.restaurantId, account.id, orderIds as string[], expected, actor.email);
  if (result.outcome !== "charged") return await chargeRefusal(result, await currencyOf(actor.restaurantId));

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "account",
    action: "charged",
    detail: logDetail({ name: account.name, amount: result.amount.toFixed(2), owed: result.owed.toFixed(2) }),
  });
  return NextResponse.json({ ok: true, amount: result.amount, owed: result.owed });
}
