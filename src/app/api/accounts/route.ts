import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { jsonBody } from "@/lib/json-body";
import { MANAGES } from "@/lib/membership";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { cleanEmail, cleanLimit, cleanName, newCode } from "@/lib/accounts";
import { accountById, listAccounts, statementOf } from "@/lib/accounts-server";
import { formatMoney } from "@/lib/format";
import { currencyOf } from "@/lib/account-charge";

export const runtime = "nodejs";

// /api/accounts — customer accounts, for the people who take money: open one,
// see what each owes, raise a ceiling, give an account a new code, close it.
// The kitchen never. Putting food on one and collecting it are their own routes.

/**
 * GET — every account and what it owes; with `?id=`, one account's statement
 * as the staff read it (who charged each order included).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  // Listed on any tier: an account opened on a paid plan still owes after a
  // move down, and the till must be able to find it to collect.
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ accounts: await listAccounts(actor.restaurantId) });

  const account = await accountById(actor.restaurantId, id);
  if (!account) return await apiError("apiErr.notFound", 404);
  const { data: restaurant } = await createAdminClient()
    .from("restaurants").select("timezone").eq("id", actor.restaurantId).maybeSingle();
  return NextResponse.json({ account, statement: await statementOf(account, restaurant?.timezone) });
}

/** POST — open an account: a name, a ceiling, and optionally an email for the statement. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const blocked = await planBlocks(actor.restaurantId, "openAccounts");
  if (blocked) return blocked;

  const body = await jsonBody<{ name?: unknown; email?: unknown; limit?: unknown }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const name = cleanName(body.name);
  if (!name) return await apiError("apiErr.accountName", 400);
  const email = cleanEmail(body.email);
  if (email === "bad") return await apiError("apiErr.email", 400);
  const limit = cleanLimit(body.limit);
  if (limit === null) return await apiError("apiErr.accountLimitAmount", 400);

  const db = createAdminClient();
  // Sixty random bits collide essentially never, but a unique index answers
  // for certain: try again with another code rather than fail the opening.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db
      .from("customer_accounts")
      .insert({
        restaurant_id: actor.restaurantId,
        name,
        email,
        code: newCode(),
        credit_limit: limit,
        opened_by: actor.email,
      })
      .select("id")
      .single();
    if (!error && data) {
      await logEvent({
        restaurantId: actor.restaurantId,
        actor: actor.email,
        entity: "account",
        action: "created",
        detail: logDetail({ name, limit: limit.toFixed(2) }),
      });
      return NextResponse.json({ ok: true, id: data.id });
    }
    if (error?.code !== "23505") break;
  }
  return await apiError("apiErr.generic", 500);
}

/**
 * PATCH — one change to one account:
 *   { id, action: "limit", limit }  a new ceiling (managers and owners)
 *   { id, action: "code" }          a new code, when the old QR went astray
 *   { id, action: "close" }         only once it owes nothing
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown; action?: unknown; limit?: unknown }>(req);
  if (!body || typeof body.id !== "string") return await apiError("apiErr.invalidRequest", 400);
  const account = await accountById(actor.restaurantId, body.id);
  if (!account) return await apiError("apiErr.notFound", 404);
  const db = createAdminClient();

  if (body.action === "limit") {
    // The ceiling is the restaurant's risk, so it is a manager's to move.
    if (!MANAGES(actor.role)) return await apiError("apiErr.forbidden", 403);
    const limit = cleanLimit(body.limit);
    if (limit === null) return await apiError("apiErr.accountLimitAmount", 400);
    const { owed } = (await listAccounts(actor.restaurantId)).find(a => a.id === account.id) ?? { owed: 0 };
    // Below what is already owed the account could never be charged again,
    // and would read as though it were over its limit through nobody's doing.
    if (limit < owed) {
      return await apiError("apiErr.accountLimitBelowOwed", 409, {
        owed: formatMoney(owed, await currencyOf(actor.restaurantId)),
      });
    }
    const { error } = await db.from("customer_accounts").update({ credit_limit: limit })
      .eq("id", account.id).eq("restaurant_id", actor.restaurantId);
    if (error) return await apiError("apiErr.generic", 500);
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "account", action: "updated",
      detail: logDetail({ name: account.name, from: Number(account.credit_limit).toFixed(2), to: limit.toFixed(2) }),
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "code") {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await db.from("customer_accounts").update({ code: newCode() })
        .eq("id", account.id).eq("restaurant_id", actor.restaurantId);
      if (!error) {
        await logEvent({
          restaurantId: actor.restaurantId, actor: actor.email, entity: "account", action: "updated",
          detail: logDetail({ name: account.name, code: "new" }),
        });
        return NextResponse.json({ ok: true });
      }
      if (error.code !== "23505") break;
    }
    return await apiError("apiErr.generic", 500);
  }

  if (body.action === "close") {
    const { owed } = (await listAccounts(actor.restaurantId)).find(a => a.id === account.id) ?? { owed: 0 };
    if (owed > 0) return await apiError("apiErr.accountStillOwes", 409);
    const { error } = await db.from("customer_accounts")
      .update({ status: "closed", closed_by: actor.email, closed_at: new Date().toISOString() })
      .eq("id", account.id).eq("restaurant_id", actor.restaurantId);
    if (error) return await apiError("apiErr.generic", 500);
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "account", action: "closed",
      detail: logDetail({ name: account.name }),
    });
    return NextResponse.json({ ok: true });
  }

  return await apiError("apiErr.invalidRequest", 400);
}
