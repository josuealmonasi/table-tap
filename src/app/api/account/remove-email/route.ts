import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { jsonBody } from "@/lib/json-body";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { normalizeCode } from "@/lib/accounts";
import { accountByCode, accountById } from "@/lib/accounts-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await jsonBody<{ id?: unknown; c?: unknown }>(req);
  const code = typeof body?.c === "string" ? normalizeCode(body.c) : null;
  const staffRequest = typeof body?.id === "string" && body.c === undefined;
  if ((!code && !staffRequest) || (code && body?.id !== undefined)) return await apiError("apiErr.invalidRequest", 400);

  const actor = staffRequest ? await actingManager() : null;
  if (staffRequest && !actor) return await apiError("apiErr.forbidden", 403);
  // A busy restaurant must not share the code holder's small IP budget.
  const limitKey = actor ? `account-remove-email:${actor.restaurantId}` : `account-remove-email:${clientKey(req)}`;
  if (await isRateLimited(limitKey, actor ? 100 : 3, 600)) return await apiError("apiErr.tooManyWait", 429);
  const account = await (actor ? accountById(actor.restaurantId, body!.id as string) : accountByCode(code!)).catch(() => undefined);
  if (account === undefined) return await apiError("apiErr.generic", 500);
  if (!account) return await apiError("apiErr.notFound", 404);
  if (!account.email) return NextResponse.json({ ok: true });

  // Match the code again at the write: staff may have replaced a lost QR
  // since the lookup, and its old holder must not change the account.
  let update = createAdminClient().from("customer_accounts").update({ email: null })
    .eq("id", account.id).eq("restaurant_id", account.restaurant_id).eq("email", account.email);
  if (code) update = update.eq("code", code);
  const { data, error } = await update.select("id").maybeSingle();
  if (error) return await apiError("apiErr.generic", 500);
  if (!data) return await apiError("apiErr.notFound", 404);
  await logEvent({ restaurantId: account.restaurant_id, actor: actor?.email ?? "customer", entity: "account", action: "updated",
    detail: logDetail({ name: account.name, email: "removed" }) });
  return NextResponse.json({ ok: true });
}
