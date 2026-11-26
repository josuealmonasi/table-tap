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
import { accountByCode, accountById, listAccounts, statementOf } from "@/lib/accounts-server";
import { logAccountLinkViewed } from "@/lib/staff-removal";
import { formatMoney } from "@/lib/format";
import { isDinerCurrency } from "@/lib/diner-currency";

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
  // The list carries no account's link: a waiter used to receive every
  // customer's reusable QR code in one response and kept them after leaving
  // (security sweep 2026-11-24). One account's link is opened on purpose,
  // below, and that opening is logged so a removal can reset what they saw.
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    // A scanned card: whoever scanned it already holds its code.
    const found = await accountByCode(code.trim().toUpperCase()).catch(() => undefined);
    if (found === undefined) return await apiError("apiErr.generic", 503);
    if (!found || found.restaurant_id !== actor.restaurantId) return await apiError("apiErr.notFound", 404);
    return NextResponse.json({ id: found.id });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    const accounts = await listAccounts(actor.restaurantId);
    return NextResponse.json({ accounts: accounts.map(account => {
      const listed: Partial<typeof account> = { ...account };
      delete listed.code;
      return listed;
    }) });
  }

  const account = await accountById(actor.restaurantId, id);
  if (!account) return await apiError("apiErr.notFound", 404);
  await logAccountLinkViewed(actor.restaurantId, actor.email, account.id, account.name);
  const timeZone = createAdminClient()
    .from("restaurants").select("timezone").eq("id", actor.restaurantId).maybeSingle()
    .then(({ data: restaurant }) => restaurant?.timezone);
  return NextResponse.json({ account, statement: await statementOf(account, timeZone) });
}

/** POST — open an account: a name, a ceiling, and optionally an email for the statement. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const blocked = await planBlocks(actor.restaurantId, "openAccounts");
  if (blocked) return blocked;

  const body = await jsonBody<{ name?: unknown; email?: unknown; limit?: unknown; currency?: unknown }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const name = cleanName(body.name);
  if (!name) return await apiError("apiErr.accountName", 400);
  const email = cleanEmail(body.email);
  if (email === "bad") return await apiError("apiErr.email", 400);
  const limit = cleanLimit(body.limit);
  if (limit === null) return await apiError("apiErr.accountLimitAmount", 400);
  // The ceiling is approved in the currency the form showed, and stored in it:
  // left to the database it took the restaurant's currency at the moment the
  // row was written (backlog 35, finding 2). A screen from before sends none.
  if (body.currency === undefined) return await apiError("apiErr.refreshToApproveLimit", 409);
  if (!isDinerCurrency(body.currency)) return await apiError("apiErr.invalidRequest", 400);

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
        credit_currency: body.currency,
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
        detail: logDetail({ name, limit: limit.toFixed(2), currency: body.currency }),
      });
      return NextResponse.json({ ok: true, id: data.id });
    }
    if (error?.code !== "23505") break;
  }
  return await apiError("apiErr.generic", 500);
}

/**
 * PATCH — one change to one account:
 *   { id, action: "limit", limit, currency }  a new ceiling, in the currency
 *                                   the manager saw (managers and owners)
 *   { id, action: "code" }          a new code, when the old QR went astray
 *   { id, action: "close" }         only once it owes nothing
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  // A ceiling, a new code and a closing are desk work, refused while the
  // subscription is locked. Collecting or forgiving what is owed is not, and
  // lives in /credit and /settle.
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const body = await jsonBody<{ id?: unknown; action?: unknown; limit?: unknown; currency?: unknown }>(req);
  if (!body || typeof body.id !== "string") return await apiError("apiErr.invalidRequest", 400);
  const account = await accountById(actor.restaurantId, body.id);
  if (!account) return await apiError("apiErr.notFound", 404);
  const db = createAdminClient();

  if (body.action === "limit") {
    // The ceiling is the restaurant's risk, so it is a manager's to move.
    if (!MANAGES(actor.role)) return await apiError("apiErr.forbidden", 403);
    const limit = cleanLimit(body.limit);
    if (limit === null) return await apiError("apiErr.accountLimitAmount", 400);
    // The amount alone let a MX$500 review become a US$500 ceiling when the
    // restaurant switched before the save (backlog 35, finding 2).
    if (body.currency === undefined) return await apiError("apiErr.refreshToApproveLimit", 409);
    if (!isDinerCurrency(body.currency)) return await apiError("apiErr.invalidRequest", 400);
    // Below what is already owed the account could never be charged again,
    // and would read as though it were over its limit through nobody's doing.
    // Checked under the account's lock, so a charge cannot land in between.
    const { data, error } = await db.rpc("account_set_limit_v1", {
      p_restaurant: actor.restaurantId, p_account: account.id,
      p_limit: limit, p_currency: body.currency, p_actor: actor.email,
    });
    if (error || !data) return await apiError("apiErr.generic", 500);
    if (data.outcome === "missing") return await apiError("apiErr.notFound", 404);
    if (data.outcome === "currency") {
      return await apiError("apiErr.accountLimitCurrencyChanged", 409, { currency: String(data.currency) });
    }
    if (data.outcome === "mixed_currency") return await apiError("apiErr.accountLimitMixed", 409);
    if (data.outcome === "limit") {
      return await apiError("apiErr.accountLimitBelowOwed", 409, {
        owed: formatMoney(Number(data.owed), body.currency),
      });
    }
    if (data.outcome !== "changed") return await apiError("apiErr.generic", 500);
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "account", action: "updated",
      detail: logDetail({ name: account.name, from: Number(data.previous_limit).toFixed(2), to: limit.toFixed(2), currency: body.currency }),
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
    // Only once nothing is owed — read under the same lock a charge takes.
    const { data, error } = await db.rpc("account_change_v2", {
      p_restaurant: actor.restaurantId, p_account: account.id,
      p_action: "close", p_limit: null, p_actor: actor.email,
    });
    if (error || !data) return await apiError("apiErr.generic", 500);
    if (data.outcome === "missing") return await apiError("apiErr.notFound", 404);
    if (data.outcome === "owes") return await apiError("apiErr.accountStillOwes", 409);
    if (data.outcome !== "changed") return await apiError("apiErr.generic", 500);
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "account", action: "closed",
      detail: logDetail({ name: account.name }),
    });
    return NextResponse.json({ ok: true });
  }

  return await apiError("apiErr.invalidRequest", 400);
}
