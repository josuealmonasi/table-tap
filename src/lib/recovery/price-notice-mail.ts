import { dateLocale, formatMoney } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { DEFAULT_LOCALE, messagesFor, translate, type Locale } from "@/lib/i18n";

export function priceNoticeMail(m: { current: number; next: number; effectiveAt: string; link: string }, locale: Locale = DEFAULT_LOCALE) {
  const t = (key: string, vars?: Record<string, string>) => translate(messagesFor(locale), key, vars);
  const vars = { current: formatMoney(m.current, "MXN"), next: formatMoney(m.next, "MXN"),
    date: new Intl.DateTimeFormat(dateLocale(locale), { dateStyle: "long", timeZone: "America/Mexico_City" }).format(new Date(m.effectiveAt)) };
  const subject = t("priceNoticeMail.subject");
  const intro = t("priceNoticeMail.intro", vars);
  const after = t("priceNoticeMail.after", vars);
  const button = t("priceNoticeMail.button");
  return { subject, text: `${intro}\n\n${after}\n\n${button}: ${m.link}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#16211C">`
      + `<p>${escapeHtml(intro)}</p><p>${escapeHtml(after)}</p>`
      + `<p><a href="${escapeHtml(m.link)}" style="display:inline-block;padding:10px 16px;background:#16211C;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a></p></div>` };
}
