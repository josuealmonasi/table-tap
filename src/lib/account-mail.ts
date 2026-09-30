import { formatMoney, dateLocale } from "@/lib/format";
import type { Statement } from "@/lib/accounts-server";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Escapes text for the HTML body: names and dishes are typed by people. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The statement as an email: the same days and dishes the page shows, the
 * balance, and the link back to it to pay. Plain HTML, no images to block.
 */
export function statementMail(
  statement: Statement,
  opts: { restaurant: string; name: string; currency: string; link: string; locale: string; timeZone: string },
  t: T,
): { subject: string; text: string; html: string } {
  const money = (n: number) => formatMoney(n, opts.currency);
  const day = (key: string) =>
    new Intl.DateTimeFormat(dateLocale(opts.locale), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
      .format(new Date(`${key}T12:00:00Z`));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale(opts.locale), { hour: "numeric", minute: "2-digit", timeZone: opts.timeZone })
      .format(new Date(iso));

  const subject = t("account.mailSubject", { restaurant: opts.restaurant });
  const lines: string[] = [t("account.mailIntro", { name: opts.name, restaurant: opts.restaurant }), ""];
  let html = `<p>${esc(t("account.mailIntro", { name: opts.name, restaurant: opts.restaurant }))}</p>`;
  for (const d of statement.days) {
    lines.push(`${day(d.day)} — ${money(d.total)}`);
    html += `<h3 style="margin:16px 0 4px">${esc(day(d.day))} — ${esc(money(d.total))}</h3><ul style="padding-left:18px;margin:0">`;
    for (const c of d.charges) {
      for (const l of c.lines) {
        const row = `${time(c.at)} · ${l.qty}× ${l.name}${l.extras.length ? ` + ${l.extras.join(", ")}` : ""} — ${money(l.amount)}`;
        lines.push(`  ${row}`);
        html += `<li>${esc(row)}</li>`;
      }
    }
    html += "</ul>";
  }
  const owed = t("account.mailOwed", { amount: money(statement.owed) });
  lines.push("", owed, t("account.mailPay", { link: opts.link }));
  html += `<p style="font-size:18px;font-weight:700">${esc(owed)}</p><p><a href="${esc(opts.link)}">${esc(t("account.mailPayLink"))}</a></p>`;
  return { subject, text: lines.join("\n"), html };
}
