import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { jsonBody } from "@/lib/json-body";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { isRateLimited } from "@/lib/rate-limit";
import { requestLocale } from "@/lib/i18n";
import { sendMail } from "@/lib/mail";
import { canonicalUuid } from "@/lib/uuid";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import {
  addRecipient, confirmationMail, listRecipients, MAX_DIGEST_RECIPIENTS, removeRecipient, renewConfirmation,
} from "@/lib/digest-recipients";

export const runtime = "nodejs";

// /api/settings/digest-recipients — the owner's extra recipients of the daily
// digest (owner decisions 2026-11-25): owner only, at most five, each confirmed
// from its own inbox before anything is sent to it.

export async function GET(): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  try {
    return NextResponse.json({ recipients: await listRecipients(actor.restaurantId), max: MAX_DIGEST_RECIPIENTS });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}

async function sendConfirmation(req: NextRequest, restaurantId: string, email: string, token: string): Promise<boolean> {
  const { data } = await createAdminClient().from("restaurants").select("name").eq("id", restaurantId).maybeSingle();
  const link = `${siteOrigin(req)}/digest/confirm?t=${token}`;
  const mail = confirmationMail({ restaurant: (data?.name as string) ?? "", link }, requestLocale(req));
  return (await sendMail({ to: email, ...mail })).sent;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ email?: unknown }>(req);
  const email = normalizeEmail(String(body?.email ?? ""));
  if (!isValidEmail(email)) return await apiError("digestRecipients.badEmail", 400);
  // Each address costs one email from our domain: bounded per owner.
  if (await isRateLimited(`digest-recipient:${actor.restaurantId}`, 10, 3600)) return await apiError("apiErr.tooManyWait", 429);
  try {
    const added = await addRecipient(actor.restaurantId, email, actor.email);
    if (added.outcome === "exists") return await apiError("digestRecipients.alreadyListed", 409);
    if (added.outcome === "full") return await apiError("digestRecipients.full", 409, { max: MAX_DIGEST_RECIPIENTS });
    if (added.outcome !== "added" || !added.token) return await apiError("apiErr.generic", 500);
    await logEvent({ restaurantId: actor.restaurantId, actor: actor.email, entity: "settings", action: "updated", detail: "digest_recipient: added" });
    const sent = await sendConfirmation(req, actor.restaurantId, email, added.token);
    return NextResponse.json({ ok: true, sent, recipients: await listRecipients(actor.restaurantId) });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}

/** PATCH { id, action: "resend" } — a fresh confirmation link for a pending address. */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown; action?: unknown }>(req);
  const id = canonicalUuid(body?.id);
  if (!id || body?.action !== "resend") return await apiError("apiErr.invalidRequest", 400);
  if (await isRateLimited(`digest-resend:${id}`, 3, 86_400)) return await apiError("apiErr.tooManyWait", 429);
  try {
    const renewed = await renewConfirmation(actor.restaurantId, id);
    if (!renewed) return await apiError("apiErr.notFound", 404);
    const sent = await sendConfirmation(req, actor.restaurantId, renewed.email, renewed.token);
    return NextResponse.json({ ok: true, sent });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown }>(req);
  if (typeof body?.id !== "string") return await apiError("apiErr.invalidRequest", 400);
  try {
    if (!(await removeRecipient(actor.restaurantId, body.id))) return await apiError("apiErr.notFound", 404);
    await logEvent({ restaurantId: actor.restaurantId, actor: actor.email, entity: "settings", action: "updated", detail: "digest_recipient: removed" });
    return NextResponse.json({ ok: true, recipients: await listRecipients(actor.restaurantId) });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
