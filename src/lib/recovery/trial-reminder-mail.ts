import { dateLocale } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { DEFAULT_LOCALE, messagesFor, translate, type Locale } from "@/lib/i18n";
import { planLabel } from "@/lib/plan";

/** The owner's "your free month ends on …" email, in their language. */
export function trialReminderMail(m: { plan: string; endsAt: string; link: string }, locale: Locale = DEFAULT_LOCALE) {
  const t = (key: string, vars?: Record<string, string>) => translate(messagesFor(locale), key, vars);
  const vars = { plan: planLabel(m.plan),
    date: new Intl.DateTimeFormat(dateLocale(locale), { dateStyle: "long", timeZone: "America/Mexico_City" }).format(new Date(m.endsAt)) };
  const subject = t("trialMail.subject", vars);
  const intro = t("trialMail.intro", vars);
  const after = t("trialMail.after", vars);
  const button = t("trialMail.button");
  return { subject, text: `${intro}\n\n${after}\n\n${button}: ${m.link}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#16211C">`
      + `<p>${escapeHtml(intro)}</p><p>${escapeHtml(after)}</p>`
      + `<p><a href="${escapeHtml(m.link)}" style="display:inline-block;padding:10px 16px;background:#0e6e6e;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a></p></div>` };
}
