import type { NextRequest } from "next/server";
import { CONFIRM_DAYS, tokenHash } from "@/lib/digest-recipients";
import { escapeHtml } from "@/lib/html";
import { messagesFor, requestLocale, translate } from "@/lib/i18n";
import { sendMail } from "@/lib/mail";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";

/** Only the request that created the pending token gets to send it. */
export async function sendCardEmailConfirmation(req: NextRequest, code: string, email: string, token: string): Promise<void> {
  const locale = requestLocale(req);
  const link = `${siteOrigin(req)}/tickets/confirm?t=${token}&lang=${locale}`;
  const messages = messagesFor(locale);
  const t = (key: string) => translate(messages, `cardEmail.${key}`, { days: String(CONFIRM_DAYS) });
  const hash = tokenHash(token);
  const result = await sendMail({
    to: email,
    subject: t("confirmSubject"),
    text: `${t("confirmIntro")}\n\n${t("confirmAction")}: ${link}\n\n${t("confirmIgnore")}`,
    html: `<p>${escapeHtml(t("confirmIntro"))}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t("confirmAction"))}</a></p><p>${escapeHtml(t("confirmIgnore"))}</p>`,
    idempotencyKey: `card-email-confirm-${hash}`,
    signal: AbortSignal.timeout(5000),
    throwOnUncertainDelivery: true,
  });
  if (result.sent) return;

  // Release a definite refusal so the user can retry. A replaced or already
  // confirmed token no longer matches, and an uncertain send throws above.
  const { error } = await createAdminClient().from("loyalty_cards").update({
    pending_email: null, pending_email_token_hash: null, pending_email_expires_at: null,
    pending_email_notice_version: null, pending_email_set_by: null,
  }).eq("code", code).eq("pending_email_token_hash", hash);
  if (error) throw new Error("Could not clear the refused card email confirmation");
  throw new Error("Could not send the card email confirmation");
}
