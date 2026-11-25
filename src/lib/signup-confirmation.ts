import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";
import { escapeHtml } from "@/lib/html";
import { messagesFor, type Locale } from "@/lib/i18n";
import { sendMail } from "@/lib/mail";

export async function sendSignupMail(req: Request, email: string, locale: Locale, token: string | null): Promise<void> {
  const copy = messagesFor(locale).signupMail;
  const origin = siteOrigin(req);
  const subject = token ? copy.confirmSubject : copy.existingSubject;
  const intro = token ? copy.confirmBody : copy.existingBody;
  const links = token
    ? [[copy.confirmButton, `${origin}/signup/confirm#token=${token}`]]
    : [[copy.signIn, `${origin}/login`], [copy.resetPassword, `${origin}/forgot-password`]];
  const result = await sendMail({
    to: email, subject,
    text: [intro, ...links.map(([label, url]) => `${label}: ${url}`)].join("\n\n"),
    html: `<p>${escapeHtml(intro)}</p>` + links.map(([label, url]) =>
      `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`).join(""),
    signal: AbortSignal.timeout(10_000),
  });
  if (!result.sent) console.error("Signup mail delivery failed", result.reason);
}

/** People who signed up before the password step moved still use their Auth link. */
export async function resendLegacySignupConfirmation(req: Request, email: string): Promise<void> {
  try {
    const { error } = await createAdminClient().auth.resend({ type: "signup", email,
      options: { emailRedirectTo: `${siteOrigin(req)}/auth/callback?next=/signup/complete` } });
    if (error) console.error("signup confirmation failed:", error.message);
  } catch {
    console.error("Could not resend legacy signup confirmation");
  }
}
