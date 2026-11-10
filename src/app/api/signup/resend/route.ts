import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { sendSignupConfirmation } from "@/lib/signup-confirmation";

export const runtime = "nodejs";

/** Resending never changes a password, a restaurant or an existing trial. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`signup-resend:${clientKey(req)}`, 5, 60)) return await apiError("apiErr.tooManyAttempts", 429);
  const body = await jsonBody<{ email?: unknown }>(req);
  if (typeof body?.email !== "string" || !isValidEmail(body.email)) return await apiError("apiErr.signupFields", 400);
  await sendSignupConfirmation(req, normalizeEmail(body.email));
  // One conditional answer, including for an unknown or already verified address.
  return NextResponse.json({ ok: true });
}
