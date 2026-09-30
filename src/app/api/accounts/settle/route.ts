import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { applyPayment } from "@/lib/table-balance";
import { accountById } from "@/lib/accounts-server";
import { currencyOf } from "@/lib/account-charge";
import { formatMoney } from "@/lib/format";

export const runtime = "nodejs";

// POST /api/accounts/settle — the customer pays their account in person, all
// of it: cash or the restaurant's own card terminal, with a tip if they leave
// one. Not held to the plan or to a frozen subscription: an account opened on
// a paid tier still owes after a move down, and money a customer is holding
// out is never refused.
//
// Body: { accountId, expected, tip, method, ref } — `expected` is the balance
// the cashier showed the customer; `ref` makes a second tap the same payment.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{
    accountId?: unknown; expected?: unknown; tip?: unknown; method?: unknown; ref?: unknown;
  }>(req);
  const expected = Number(body?.expected);
  if (!body || typeof body.accountId !== "string" || !Number.isFinite(expected) || expected <= 0 ||
      (body.method !== "cash" && body.method !== "card") ||
      (body.ref !== undefined && (typeof body.ref !== "string" || body.ref.length > 80))) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const account = await accountById(actor.restaurantId, body.accountId);
  if (!account) return await apiError("apiErr.notFound", 404);

  // The same ceiling on a gratuity as a table's: never more than the food.
  const { tip } = applyPayment(expected, expected, Number(body.tip ?? 0));

  const { data, error } = await createAdminClient().rpc("account_settle", {
    p_restaurant: actor.restaurantId,
    p_account: account.id,
    p_expected: expected,
    p_tip: tip,
    p_method: body.method,
    p_actor: actor.email,
    p_ref: typeof body.ref === "string" ? `account:${body.ref}` : null,
  });
  if (error) {
    console.error("account settle failed:", error.message);
    return await apiError("apiErr.generic", 500);
  }
  const r = data as { outcome: string; amount?: number; tip?: number; owed?: number };
  if (r.outcome === "duplicate") return NextResponse.json({ ok: true, duplicate: true });
  if (r.outcome === "missing") return await apiError("apiErr.notFound", 404);
  if (r.outcome === "nothing") return await apiError("apiErr.accountNothingOwed", 409);
  if (r.outcome === "paying") return await apiError("apiErr.accountPayingOnline", 409);
  if (r.outcome === "changed") {
    return await apiError("apiErr.accountBalanceChanged", 409, {
      owed: formatMoney(Number(r.owed), await currencyOf(actor.restaurantId)),
    });
  }

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "account",
    action: "paid",
    detail: logDetail({
      name: account.name, amount: Number(r.amount).toFixed(2), tip: Number(r.tip).toFixed(2), method: body.method,
    }),
  });
  return NextResponse.json({ ok: true, amount: r.amount, tip: r.tip });
}
