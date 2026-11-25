import { dateLocale, formatMoney } from "@/lib/format";
import { escapeHtml as h } from "@/lib/html";
import type { Locale } from "@/lib/i18n";
import type { Mail } from "@/lib/mail";
import type { DigestFigures } from "./digest-figures";
import { digestCopy } from "./digest-mail-copy";

interface DigestMailOptions {
  name: string;
  currency: string;
  timezone: string;
  locale: Locale;
  owner: boolean;
  /** An outside address the owner added and its holder confirmed. */
  guest?: boolean;
  dashboard: string;
  stop: string;
  oneClick: string;
}

const TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0"';
const INK = "#111113";
const MUTED = "#6b6b72";
const ACCENT = "#0e6e6e";
const LINE = "border-bottom:1px solid #e4e4e7;";
const money = (amount: number, currency: string) => formatMoney(amount, currency).replace(/\.00$/, "");

function rows(values: string[][], padding: number, color: string, borders = false): string {
  return values.map(([label, value], i) => {
    const style = `padding:${padding}px 0;${borders && i < values.length - 1 ? LINE : ""}`;
    return `<tr><td style="${style}">${h(label)}</td><td align="right" style="${style}color:${color};">${h(value)}</td></tr>`;
  }).join("");
}

export function digestMail(f: DigestFigures, options: DigestMailOptions): Omit<Mail, "to"> {
  const { name, currency, timezone: timeZone, locale, owner, guest, dashboard, stop, oneClick } = options;
  const copy = digestCopy[locale];
  const date = new Intl.DateTimeFormat(dateLocale(locale), { timeZone, weekday: "long", day: "numeric", month: "long" }).format(f.day);
  const weekday = new Intl.DateTimeFormat(dateLocale(locale), { timeZone, weekday: "long" }).format(f.day);
  const number = new Intl.NumberFormat(dateLocale(locale));
  const place = `${name} · ${date}`;
  const amount = (value: number) => money(value, currency);
  const reduction = (value: number) => value ? `−${amount(value)}` : amount(0);
  const change = f.salesChange === null ? copy.noComparison
    : `${f.salesChange > 0 ? "▲ " : f.salesChange < 0 ? "▼ " : ""}${Math.abs(f.salesChange)}% ${copy.compare(weekday)}`;
  const tickets = `${number.format(f.count)} · ${amount(f.avgTicket)}`;
  const split = copy.split(f.dineIn, f.toGo);
  const amounts = [[copy.card, amount(f.card)], [copy.cash, amount(f.cash)], [copy.tips, amount(f.tips)],
    [copy.discounts, reduction(f.discounts)], [`${copy.refunds} (${number.format(f.refunds.count)})`, reduction(f.refunds.amount)]];
  const a = f.attention;
  const attention = [
    a.discounts && copy.discountRequests(a.discounts),
    a.writeOffs && copy.writeOffs(a.writeOffs),
    a.offline && copy.offline(a.offline),
    a.accounts.count && copy.accounts(a.accounts.count, a.accounts.balances.map(b => money(b.amount, b.currency)).join(" · ")),
    a.stockouts.length && copy.stock(a.stockouts.length, a.stockouts.join(", ")),
    a.due && copy.due(a.due),
  ].filter((line): line is string => Boolean(line));
  const dishes = f.dishes.map(d => [d.name, number.format(d.qty)]);
  const footer = copy.footer(name, owner, guest);
  const heading = (title: string) => `<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:${INK};">${h(title)}</p>`;
  const highlight = (label: string, value: string, detail: string, accent: boolean) =>
    `<td width="50%" style="padding:14px;${accent ? "background:#e7f1f1;" : "border:1px solid #e4e4e7;"}border-radius:10px;">
      <p style="margin:0;font-size:12px;color:#3a3a3f;">${h(label)}</p>
      <p style="margin:2px 0 0;font-size:24px;font-weight:700;color:${INK};">${h(value)}</p>
      <p style="margin:2px 0 0;font-size:12px;color:${accent ? ACCENT : MUTED};">${h(detail)}</p></td>`;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#3a3a3f;">
  <table ${TABLE} style="background:#f4f4f5;padding:16px 12px 40px;"><tr><td align="center">
  <table ${TABLE} style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px 26px;"><tr><td>
    <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:${ACCENT};">TableTap</p>
    <p style="margin:0 0 18px;font-size:13px;color:${MUTED};">${h(place)}</p>
    <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:${INK};">${h(copy.headline)}</h1>
    <table ${TABLE} style="margin:0 0 18px;"><tr>${highlight(copy.sales, amount(f.sales), change, true)}
      <td width="10"></td>${highlight(copy.orders, tickets, split, false)}</tr></table>
    <table ${TABLE} style="font-size:14px;margin:0 0 20px;">${rows(amounts, 7, INK, true)}</table>
    ${attention.length ? `${heading(copy.attention)}
      <table ${TABLE} style="background:#fbf3e2;border-radius:10px;padding:6px 14px;margin:0 0 20px;font-size:14px;">
        ${attention.map(line => `<tr><td style="padding:7px 0;color:#3a3a3f;">${h(line)}</td></tr>`).join("")}
      </table>` : ""}
    ${dishes.length ? `${heading(copy.dishes)}<table ${TABLE} style="font-size:14px;margin:0 0 22px;">${rows(dishes, 5, MUTED)}</table>` : ""}
    <p style="margin:0 0 22px;"><a href="${h(dashboard)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${h(copy.dashboard)}</a></p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">${h(footer)} <a href="${h(stop)}" style="color:${MUTED};">${h(copy.stop)}</a></p>
  </td></tr></table></td></tr></table></body></html>`;
  const lines = [...amounts.map(p => p.join(" · ")),
    ...(attention.length ? ["", copy.attention, ...attention] : []),
    ...(dishes.length ? ["", copy.dishes, ...dishes.map(p => p.join(" · "))] : [])];
  const text = ["TableTap", place, copy.headline, "", `${copy.sales} · ${amount(f.sales)}`, change,
    `${copy.orders} · ${tickets}`, split, "", ...lines, "", copy.dashboard, dashboard, "", footer, copy.stop, stop].join("\n");
  return { subject: `${copy.headline} · ${name}`, html, text,
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}
