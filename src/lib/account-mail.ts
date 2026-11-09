import { formatMoney, dateLocale } from "@/lib/format";
import { balancesLabel } from "@/lib/currency-balances";
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
  const day = (key: string) =>
    new Intl.DateTimeFormat(dateLocale(opts.locale), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
      .format(new Date(`${key}T12:00:00Z`));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale(opts.locale), { hour: "numeric", minute: "2-digit", timeZone: opts.timeZone })
      .format(new Date(iso));
  const date = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale(opts.locale), { dateStyle: "medium", timeZone: opts.timeZone }).format(new Date(iso));

  const subject = t("account.mailSubject", { restaurant: opts.restaurant });
  const lines: string[] = [t("account.mailIntro", { name: opts.name, restaurant: opts.restaurant }), ""];
  let html = `<p>${esc(t("account.mailIntro", { name: opts.name, restaurant: opts.restaurant }))}</p>`;
  for (const d of statement.days) {
    lines.push(`${day(d.day)} — ${formatMoney(d.total, d.currency ?? opts.currency)}`);
    html += `<h3 style="margin:16px 0 4px">${esc(day(d.day))} — ${esc(formatMoney(d.total, d.currency ?? opts.currency))}</h3><ul style="padding-left:18px;margin:0">`;
    for (const c of d.charges) {
      for (const l of c.lines) {
        const row = `${time(c.at)} · ${l.qty}× ${l.name}${l.extras.length ? ` + ${l.extras.join(", ")}` : ""} — ${formatMoney(l.amount, c.currency ?? d.currency ?? opts.currency)}`;
        lines.push(`  ${row}`);
        html += `<li>${esc(row)}</li>`;
      }
    }
    html += "</ul>";
  }
  // The email and the page must tell the same payment and return story.
  const section = (title: string, rows: string[]): void => {
    if (!rows.length) return;
    lines.push("", title, ...rows.map(row => `  ${row}`));
    html += `<h3>${esc(title)}</h3><ul>${rows.map(row => `<li>${esc(row)}</li>`).join("")}</ul>`;
  };
  section(t("account.paidBefore"), statement.payments.map(p => {
    const amount = p.currency ? formatMoney(p.amount, p.currency) : `${Number(p.amount).toFixed(2)} · ${t("attribution.currencyUnknown")}`;
    return `${date(p.at)} · ${amount} · ${t(p.method === "cash" ? "account.byCash" : "account.byCard")}`;
  }));
  section(t("returns.title"), (statement.returns ?? []).map(r =>
    `${formatMoney(Number(r.amount), r.currency)} · ${t(`returns.${r.status}`)}`));
  const balances = statement.balances ?? [{ currency: statement.currency ?? opts.currency, amount: statement.owed }];
  // Paying the last charge leaves an empty list, not an empty amount on paper.
  const owed = t("account.mailOwed", { amount: balancesLabel(balances) || formatMoney(0, statement.currency ?? opts.currency) });
  lines.push("", owed, t("account.mailPay", { link: opts.link }));
  html += `<p style="font-size:18px;font-weight:700">${esc(owed)}</p><p><a href="${esc(opts.link)}">${esc(t("account.mailPayLink"))}</a></p>`;
  return { subject, text: lines.join("\n"), html };
}
