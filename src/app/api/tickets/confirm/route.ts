import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { tokenHash, validToken } from "@/lib/digest-recipients";
import { isRoomLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRoomLimited(req, "tickets-confirm", 20)) return await apiError("apiErr.tooManyRequests", 429);
  const body = await jsonBody<{ token?: unknown }>(req);
  if (!validToken(body?.token)) return await apiError("cardEmail.confirmMissing", 404);
  const { data, error } = await createAdminClient().rpc("confirm_card_email", { p_token_hash: tokenHash(body.token) });
  if (error) return await apiError("apiErr.generic", 503);
  if (!data) return await apiError("cardEmail.confirmMissing", 404);
  return NextResponse.json({ ok: true });
}
