import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { readDigestStopToken } from "@/lib/digest-stop-token";
import { isRoomLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Like tickets, a browser GET only shows the button. Providers can POST directly. */
export async function POST(req: NextRequest) {
  if (await isRoomLimited(req, "digest-stop", 20)) return await apiError("apiErr.tooManyRequests", 429);
  const recipient = readDigestStopToken(req.nextUrl.searchParams.get("t"));
  if (!recipient) return await apiError("apiErr.invalidRequest", 400);
  const form = await req.formData().catch(() => null);
  const fromMailClient = form?.get("List-Unsubscribe") === "One-Click";
  if (!fromMailClient && form?.get("stopDigest") !== "1") return await apiError("apiErr.invalidRequest", 400);
  const { data: stopped, error } = await createAdminClient().rpc("stop_digest_staff_v2", {
    p_restaurant: recipient.restaurantId, p_user: recipient.userId,
    p_address: recipient.addressKey, p_version: recipient.version,
  });
  if (error) return await apiError("apiErr.generic", 503);
  if (!stopped) return await apiError("apiErr.invalidRequest", 400);
  if (fromMailClient) return NextResponse.json({ ok: true });
  const done = new URL(`/digest/opt-out?stopped=1&lang=${recipient.locale}`, req.url);
  return NextResponse.redirect(done, 303);
}
