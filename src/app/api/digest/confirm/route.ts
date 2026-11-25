import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { confirmRecipient, validToken } from "@/lib/digest-recipients";

export const runtime = "nodejs";

// POST /api/digest/confirm { token } — the button on /digest/confirm. Mail scanners
// open links, so only this POST changes anything. Answers the restaurant's name.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`digest-confirm:${clientKey(req)}`, 10, 60)) return await apiError("apiErr.tooManyWait", 429);
  const body = await jsonBody<{ token?: unknown }>(req);
  if (!validToken(body?.token)) return await apiError("apiErr.notFound", 404);
  try {
    const restaurant = await confirmRecipient(body.token);
    if (restaurant === null) return await apiError("apiErr.notFound", 404);
    return NextResponse.json({ ok: true, restaurant });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
