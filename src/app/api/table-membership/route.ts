import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { memberHash, memberToken, newMemberToken, hashMemberToken, keepMemberToken } from "@/lib/table-member-cookie";
import { requestTableMember, tableMember } from "@/lib/table-membership";
import { pendingPhones } from "@/lib/table-member-requests";
import { tableOf } from "@/lib/table-guard";
import { clientKey, forTheRoom, isRateLimited, isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { MEMBER_POLL_MS, perMinute } from "@/lib/poll";
import { issueVisitPass } from "@/lib/loyalty/pass";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Body { restaurantId?: string; tableId?: string; memberId?: string; approve?: boolean }
const valid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

/** Joining never opens a sitting. The first real checkout does that atomically. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Browser forms cannot replace the HttpOnly credential with a fresh one
  // during a cross-site navigation; our own fetches send JSON.
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (await isRoomLimited(req, "table-member", forTheRoom(perMinute(MEMBER_POLL_MS)))) {
    return await apiError("apiErr.tooManyRequests", 429);
  }
  const body = await jsonBody<Body>(req);
  if (!valid(body?.restaurantId) || !valid(body?.tableId)) return await apiError("apiErr.invalidRequest", 400);
  const { restaurantId, tableId } = body;
  if (await isTableLimited(req, "table-member", tableId, forTheRoom(perMinute(MEMBER_POLL_MS)))) {
    return await apiError("apiErr.tooManyRequests", 429);
  }
  if (!await tableOf(restaurantId, tableId)) return await apiError("apiErr.tableNotFound", 404);
  const token = memberToken(req) ?? newMemberToken();
  try {
    const state = await requestTableMember(restaurantId, tableId, hashMemberToken(token));
    const pass = state.status === "approved" && state.sessionId
      ? issueVisitPass(restaurantId, { table: tableId, session: state.sessionId }) : "";
    return keepMemberToken(NextResponse.json({ ...state, pass }), token);
  } catch {
    return await apiError("apiErr.ordersLoad", 503);
  }
}

/** The floor polls the same row of open requests; approved phones see only their sitting. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`table-member-list:${clientKey(req)}`, forTheRoom(perMinute(MEMBER_POLL_MS)), 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }
  const restaurantId = req.nextUrl.searchParams.get("restaurantId");
  const tableId = req.nextUrl.searchParams.get("tableId");
  if (!valid(restaurantId) || (tableId && !valid(tableId))) return await apiError("apiErr.invalidRequest", 400);
  try {
    const member = tableId ? await tableMember(req, restaurantId, tableId) : null;
    if (member) return NextResponse.json({ pending: await pendingPhones(restaurantId, member.sessionId) });
    const actor = await actingFrontOfHouse();
    if (!actor || actor.restaurantId !== restaurantId) return await apiError("apiErr.forbidden", 403);
    return NextResponse.json({ pending: await pendingPhones(restaurantId) });
  } catch {
    return await apiError("apiErr.ordersLoad", 503);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (await isRateLimited(`table-member-decide:${clientKey(req)}`, forTheRoom(20), 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }
  const body = await jsonBody<Body>(req);
  if (!valid(body?.restaurantId) || !valid(body?.tableId) || !valid(body?.memberId) || typeof body?.approve !== "boolean") {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const { restaurantId, tableId, memberId, approve } = body;
  try {
    const member = await tableMember(req, restaurantId, tableId);
    const actor = member ? null : await actingFrontOfHouse();
    if (!member && (!actor || actor.restaurantId !== restaurantId)) return await apiError("apiErr.forbidden", 403);
    const { data, error } = await createAdminClient().rpc("decide_table_member", {
      p_member: memberId, p_restaurant: restaurantId, p_table: tableId, p_approve: approve,
      p_staff: actor?.email ?? null, p_hash: member ? memberHash(req) : null,
    });
    if (error) return await apiError("apiErr.generic", 503);
    if (!data) return await apiError("apiErr.requestGone", 409);
    return NextResponse.json({ ok: true });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
