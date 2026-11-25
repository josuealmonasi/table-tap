import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { stopRecipient, validToken } from "@/lib/digest-recipients";

export const runtime = "nodejs";

// POST /api/digest/stop { token } — the button on /digest/stop. Mail scanners
// open links, so only this POST changes anything. Answers the restaurant's name.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`digest-stop:${clientKey(req)}`, 10, 60)) return await apiError("apiErr.tooManyWait", 429);
  // The page's button sends JSON; a mail app's one-click unsubscribe POSTs a
  // form to the List-Unsubscribe URL, which carries the token in the query.
  const fromQuery = req.nextUrl.searchParams.get("t");
  if (fromQuery !== null) {
    const form = await req.formData().catch(() => null);
    if (form?.get("List-Unsubscribe") !== "One-Click") return await apiError("apiErr.invalidRequest", 400);
  }
  const token = fromQuery ?? (await jsonBody<{ token?: unknown }>(req))?.token;
  if (!validToken(token)) return await apiError("apiErr.notFound", 404);
  try {
    const restaurant = await stopRecipient(token);
    if (restaurant === null) return await apiError("apiErr.notFound", 404);
    return NextResponse.json({ ok: true, restaurant });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
