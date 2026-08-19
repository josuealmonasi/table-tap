import { formatMoney } from "@/lib/format";
import { lineUnitPrice, orderCode, type OrderLineItem } from "@/lib/types";

export interface ReceiptOrder {
  id: string;
  items: OrderLineItem[] | null;
  subtotal: number | string;
  discount?: number | string | null;
  service_fee?: number | string | null;
  tip?: number | string | null;
  total: number | string;
  currency: string;
  table_label?: string | null;
  created_at: string;
  pay_method?: string | null;
}

export interface Receipt {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The receipt a diner asked for, in both the plain and the rich form.
 *
 * Pure, so the arithmetic and the wording can be argued with in a test rather
 * than discovered in somebody's inbox. It repeats the same three rows the bill
 * showed on the phone — dishes, what came off, what was paid — because a
 * receipt that disagrees with the screen the diner just looked at is worse
 * than no receipt.
 *
 * Nothing in it identifies the diner: they gave us an address to send it to,
 * not permission to write to them.
 */
export function buildReceipt(
  orders: ReceiptOrder[],
  place: {
    name: string;
    /** IANA zone the restaurant keeps its clock in. */
    timeZone: string;
    /** The language the diner was reading the app in when they asked. */
    locale: string;
  },
  t: (key: string, vars?: Record<string, string | number>) => string,
): Receipt {
  // Settling a table pays for several orders at once, so a receipt covers
  // whatever was paid for — one ticket or the whole table. The code names the
  // first of them, which is the one the tip and the discount were recorded on.
  const order = orders[0];
  const cur = order.currency;
  const num = (v: number | string | null | undefined) => Number(v ?? 0);
  const code = orderCode(order.id);
  const sum = (pick: (o: ReceiptOrder) => number) => orders.reduce((n, o) => n + pick(o), 0);
  const discount = sum(o => num(o.discount));
  const service = sum(o => num(o.service_fee));
  const tip = sum(o => num(o.tip));
  const gross = sum(o => num(o.subtotal)) + discount;
  const paid = sum(o => num(o.total));

  const lines = orders.flatMap(o =>
    (o.items ?? []).map(item => ({
      label: `${item.qty}× ${item.name}`,
      amount: lineUnitPrice(item) * item.qty,
    })),
  );

  // Amounts are pre-formatted here so the discount reads the way it does on
  // the phone — "−MX$5.00", a real minus sign in front of a positive number,
  // not Intl's hyphenated negative. A receipt that formats money differently
  // from the screen it is confirming looks like it came from somewhere else.
  const rows: [string, string][] = [];
  if (discount > 0) {
    rows.push([t("totals.subtotal"), formatMoney(gross, cur)]);
    rows.push([t("totals.discount"), `−${formatMoney(discount, cur)}`]);
  }
  if (service > 0) rows.push([t("receipt.service"), formatMoney(service, cur)]);
  if (tip > 0) rows.push([t("totals.tip"), formatMoney(tip, cur)]);

  // Stamped in the restaurant's own time, not the server's. Left to the
  // server, a receipt for an eight o'clock dinner in Mexico City comes out of
  // a UTC host saying two in the morning the next day — and the one thing a
  // receipt has to get right is when it happened.
  const when = new Date(order.created_at).toLocaleString(place.locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: place.timeZone,
  });

  const text = [
    place.name,
    t("receipt.heading", { code }),
    order.table_label ? t("receipt.table", { label: order.table_label }) : "",
    when,
    "",
    ...lines.map(l => `${l.label}  ${formatMoney(l.amount, cur)}`),
    "",
    ...rows.map(([label, amount]) => `${label}  ${amount}`),
    `${t("totals.total")}  ${formatMoney(paid, cur)}`,
    "",
    t("receipt.footer"),
    t("receipt.notFiscal"),
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#16211C">
  <h1 style="font-size:20px;margin:0">${esc(place.name)}</h1>
  <p style="margin:4px 0 0;color:#6E7A74;font-size:13px">
    ${esc(t("receipt.heading", { code }))}${order.table_label ? ` · ${esc(t("receipt.table", { label: order.table_label }))}` : ""}<br>${esc(when)}
  </p>
  <table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:14px">
    ${lines
      .map(
        l => `<tr><td style="padding:6px 0">${esc(l.label)}</td>
        <td style="padding:6px 0;text-align:right">${esc(formatMoney(l.amount, cur))}</td></tr>`,
      )
      .join("")}
    ${rows
      .map(
        ([label, amount]) =>
          `<tr><td style="padding:4px 0;color:#6E7A74;border-top:1px solid #E3E2DC">${esc(label)}</td>
        <td style="padding:4px 0;text-align:right;color:#6E7A74;border-top:1px solid #E3E2DC">${esc(amount)}</td></tr>`,
      )
      .join("")}
    <tr>
      <td style="padding:10px 0 0;font-weight:700;border-top:2px solid #16211C">${esc(t("totals.total"))}</td>
      <td style="padding:10px 0 0;text-align:right;font-weight:700;border-top:2px solid #16211C">${esc(formatMoney(paid, cur))}</td>
    </tr>
  </table>
  <p style="margin-top:24px;color:#6E7A74;font-size:12px">${esc(t("receipt.footer"))}</p>
  <p style="margin-top:8px;color:#6E7A74;font-size:12px">${esc(t("receipt.notFiscal"))}</p>
</div>`.trim();

  return { subject: t("receipt.subject", { restaurant: place.name, code }), text, html };
}
