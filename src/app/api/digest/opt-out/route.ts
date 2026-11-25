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
  const { error } = await createAdminClient().auth.admin.updateUserById(recipient.userId, { user_metadata: { digest: false } });
  // Auth may have deleted the account after this link was issued.
  if (error && error.code !== "user_not_found") return await apiError("apiErr.generic", 503);
  if (fromMailClient) return NextResponse.json({ ok: true });
  const done = new URL(`/digest/opt-out?stopped=1&lang=${recipient.locale}`, req.url);
  return NextResponse.redirect(done, 303);
}
