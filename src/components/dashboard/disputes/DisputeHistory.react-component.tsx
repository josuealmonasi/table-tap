"use client";

import { SEP } from "@/lib/separator";
import { dateLocale, formatMoney } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/context";
import { minorUnits } from "@/lib/disputes/report";
import { NEEDS_REVIEW, type DisputeHistory } from "@/lib/disputes/types";

interface Props { disputes: DisputeHistory[] }

/**
 * One order's chargebacks. The page reads them once (`useDisputeHistory`) and
 * says once when that read fails, so a row with none renders nothing: ten
 * loading lines and ten identical alerts on one page were noise (review screens4).
 */
export default function DisputeHistoryLines({ disputes }: Props) {
  const t = useT();
  const { locale } = useLocale();
  if (disputes.length === 0) return null;
  return <>{disputes.map(dispute => <div key={dispute.id} className="tt-muted">
    <p>{t("disputes.history", { date: new Date(dispute.provider_created_at).toLocaleDateString(dateLocale(locale)),
      amount: formatMoney(minorUnits(dispute.amount_minor, dispute.currency), dispute.currency),
      status: t(`disputes.${dispute.status}`) })}</p>
    {dispute.shared && <p>{t("disputes.shared")}</p>}
    {dispute.reconciliation_state === NEEDS_REVIEW ? <p>{t("disputes.needsReviewState")}</p>
      : dispute.reconciliation_state !== "reconciled" && <p>{t("disputes.pending", { count: 1 })}</p>}
    {dispute.movements.map(tx => <p key={tx.stripe_balance_transaction_id}>
      {new Date(tx.provider_created_at).toLocaleDateString(dateLocale(locale))}: {t(tx.amount_minor < 0 ? "disputes.withdrawn" : "disputes.reinstated")} {formatMoney(minorUnits(tx.amount_minor, tx.currency), tx.currency)}
      {SEP}{t("disputes.fees")} {formatMoney(minorUnits(tx.fee_minor, tx.currency), tx.currency)}
    </p>)}
  </div>)}</>;
}
