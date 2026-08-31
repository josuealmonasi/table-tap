"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import type { Corte } from "@/lib/corte";

/**
 * The register close, as a manager reads it and as they print it.
 *
 * Per person, because a drawer is counted by whoever filled it and a single
 * day total cannot say which one is short. Cash is called out on every line:
 * it is the only part that has to physically match.
 *
 * What never arrived — written off, discounted — sits underneath rather than
 * being netted off. Subtracting it would hide the two numbers a manager most
 * wants to see on a bad night.
 */
export default function CorteCard({
  corte,
  currency,
  restaurantName,
  day,
}: {
  corte: Corte;
  currency: string;
  restaurantName: string;
  day: string;
}) {
  const t = useT();
  const money = (n: number) => formatMoney(n, currency);

  /** A sheet somebody can sign. Same approach as the QR cards. */
  function print(): void {
    const rows = corte.people
      .map(
        p =>
          `<tr><td>${escapeHtml(p.actor)}</td><td>${p.count}</td>` +
          `<td>${money(p.cash)}</td><td>${money(p.card)}</td><td><b>${money(p.total)}</b></td></tr>`,
      )
      .join("");
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    w.document.write(
      `<!doctype html><title>${escapeHtml(t("corte.title"))}</title>` +
        `<body style="font-family:system-ui,sans-serif;padding:28px;color:#111113">` +
        `<h1 style="margin:0;font-size:20px">${escapeHtml(t("corte.title"))}</h1>` +
        `<p style="margin:4px 0 18px;color:#70707a">${escapeHtml(restaurantName)} · ${escapeHtml(day)}</p>` +
        `<table style="width:100%;border-collapse:collapse;font-size:14px">` +
        `<thead><tr style="text-align:left;border-bottom:1px solid #e6e6e9">` +
        `<th>${escapeHtml(t("corte.who"))}</th><th>${escapeHtml(t("corte.count"))}</th>` +
        `<th>${escapeHtml(t("till.cash"))}</th><th>${escapeHtml(t("till.card"))}</th>` +
        `<th>${escapeHtml(t("corte.total"))}</th></tr></thead>` +
        `<tbody>${rows}</tbody>` +
        `<tfoot><tr style="border-top:2px solid #111113;font-weight:700">` +
        `<td>${escapeHtml(t("corte.total"))}</td><td>${corte.totals.count}</td>` +
        `<td>${money(corte.totals.cash)}</td><td>${money(corte.totals.card)}</td>` +
        `<td>${money(corte.totals.total)}</td></tr></tfoot></table>` +
        `<p style="margin-top:20px;font-size:14px">${escapeHtml(t("corte.writtenOff"))}: ${money(corte.writtenOff)}` +
        ` &nbsp;·&nbsp; ${escapeHtml(t("corte.discounted"))}: ${money(corte.discounted)}</p>` +
        `<p style="margin-top:44px;font-size:13px;color:#70707a">${escapeHtml(t("corte.signature"))}</p>` +
        `<div style="margin-top:34px;border-top:1px solid #111113;width:260px"></div>` +
        `</body>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("corte.title")}
        </h3>
        {corte.totals.count > 0 && (
          <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={print}>
            {t("corte.print")}
          </button>
        )}
      </div>
      <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
        {t("corte.hint")}
      </p>

      {corte.totals.count === 0 ? (
        <p className="tt-muted" style={{ fontSize: 13, margin: 0 }}>
          {t("corte.empty")}
        </p>
      ) : (
        <>
          {/* Laid out as the sum it is: one column per figure, every number
              right-aligned on the same edge, and the total ruled underneath the
              column it adds up. Reading a corte means running your eye down a
              column, which a row of inline labels does not let you do. The
              screen matches the printed sheet for the same reason. */}
          <div className="tt-corte-scroll">
            <div className="tt-corte-table" role="table">
              <div className="tt-corte-head" role="row">
                <span role="columnheader">{t("corte.who")}</span>
                <span role="columnheader">{t("corte.count")}</span>
                <span role="columnheader">{t("till.cash")}</span>
                <span role="columnheader">{t("till.card")}</span>
                <span role="columnheader">{t("corte.total")}</span>
              </div>

              {corte.people.map(p => (
                <div key={p.actor} className="tt-corte-row" role="row">
                  <span className="tt-corte-who">{p.actor}</span>
                  <span>{p.count}</span>
                  <span>{money(p.cash)}</span>
                  <span>{money(p.card)}</span>
                  <strong>{money(p.total)}</strong>
                </div>
              ))}

              <div className="tt-corte-sum" role="row">
                <strong>{t("corte.total")}</strong>
                <strong>{corte.totals.count}</strong>
                <strong>{money(corte.totals.cash)}</strong>
                <strong>{money(corte.totals.card)}</strong>
                <strong>{money(corte.totals.total)}</strong>
              </div>
            </div>
          </div>

          {/* Underneath, not netted off: subtracting what never arrived would
              hide the two numbers a manager most wants on a bad night. */}
          <div className="tt-corte-foot">
            <span className="tt-muted">
              {t("corte.writtenOff")} <strong>{money(corte.writtenOff)}</strong>
            </span>
            <span className="tt-muted">
              {t("corte.discounted")} <strong>{money(corte.discounted)}</strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
