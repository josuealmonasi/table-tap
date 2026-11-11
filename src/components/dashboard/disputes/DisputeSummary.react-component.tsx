"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { DisputeReport } from "@/lib/disputes/types";

interface Props { report: DisputeReport; contribution?: number; currency?: string }

export default function DisputeSummary({ report, contribution, currency }: Props) {
  const t = useT();
  const adjustment = report.currencies.find(c => c.currency === currency)?.net ?? 0;
  const incomplete = report.pending > 0 || report.currencies.some(c => c.currency !== currency && c.net !== 0);
  return <section className="tt-section" aria-label={t("disputes.title")}>
    <h3 className="tt-serif">{t("disputes.title")}</h3>
    <p className="tt-muted">{t("disputes.help")}</p>
    {report.currencies.map(row => <div key={row.currency}>
      <p><strong>{row.currency}</strong></p>
      <p>{t("disputes.withdrawn")}: {formatMoney(row.withdrawn, row.currency)}</p>
      <p>{t("disputes.reinstated")}: {formatMoney(row.reinstated, row.currency)}</p>
      <p>{t("disputes.fees")}: {formatMoney(row.fees, row.currency)}</p>
      <p>{t("disputes.adjustments")}: <strong>{formatMoney(row.net, row.currency)}</strong></p>
      <p>{t("disputes.exposure")}: {formatMoney(row.exposure, row.currency)}</p>
    </div>)}
    {report.currencies.length === 0 && <p>{t("disputes.empty")}</p>}
    <p>{t("disputes.outcomes", { won: report.won, lost: report.lost })}</p>
    {report.pending > 0 && <p role="note">{t("disputes.pending", { count: report.pending })}</p>}
    {contribution !== undefined && currency && <>
      <p>{t("disputes.adjustments")}: <strong>{formatMoney(adjustment, currency)}</strong></p>
      <p>{t("disputes.after")}: <strong>{formatMoney(contribution + adjustment, currency)}</strong></p>
      {incomplete && <p role="note">{t("disputes.incomplete")}</p>}
    </>}
  </section>;
}
