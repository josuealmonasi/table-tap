"use client";

import { SEP } from "@/lib/separator";
import useSWR from "swr";
import { dateLocale, formatMoney } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/context";
import { minorUnits } from "@/lib/disputes/report";
import type { DisputeHistory } from "@/lib/disputes/types";

interface Props { orderId: string; restaurantId: string; orderIds?: string[] }

async function fetchHistory([, , orders]: readonly [string, string, string[]]): Promise<Record<string, DisputeHistory[]>> {
  try {
    const query = new URLSearchParams();
    orders.forEach(order => query.append("order", order));
    const response = await fetch(`/api/disputes/history?${query}`);
    if (!response.ok) throw new Error("Dispute history unavailable");
    return await response.json() as Record<string, DisputeHistory[]>;
  } catch (cause) {
    throw new Error("Dispute history unavailable", { cause });
  }
}

export default function DisputeHistoryLines({ orderId, restaurantId, orderIds = [orderId] }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const { data, error } = useSWR(["dispute-history", restaurantId, orderIds] as const, fetchHistory);
  if (error) return <p role="alert">{t("disputes.unavailable")}</p>;
  if (!data) return <p role="status">{t("disputes.loading")}</p>;
  return <>{(data[orderId] ?? []).map(dispute => <div key={dispute.id} className="tt-muted">
    <p>{t("disputes.history", { date: new Date(dispute.provider_created_at).toLocaleDateString(dateLocale(locale)),
      amount: formatMoney(minorUnits(dispute.amount_minor, dispute.currency), dispute.currency),
      status: t(`disputes.${dispute.status}`) })}</p>
    {dispute.shared && <p>{t("disputes.shared")}</p>}
    {dispute.reconciliation_state !== "reconciled" && <p>{t("disputes.pending", { count: 1 })}</p>}
    {dispute.movements.map(tx => <p key={tx.stripe_balance_transaction_id}>
      {new Date(tx.provider_created_at).toLocaleDateString(dateLocale(locale))}: {t(tx.amount_minor < 0 ? "disputes.withdrawn" : "disputes.reinstated")} {formatMoney(minorUnits(tx.amount_minor, tx.currency), tx.currency)}
      {SEP}{t("disputes.fees")} {formatMoney(minorUnits(tx.fee_minor, tx.currency), tx.currency)}
    </p>)}
  </div>)}</>;
}
