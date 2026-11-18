"use client";

import useSWR from "swr";
import { Modal } from "@/components/ui/Modal";
import { dateLocale, formatMoney } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/context";
import type { readAdminUsage } from "@/lib/admin-usage-read";

type Usage = NonNullable<Awaited<ReturnType<typeof readAdminUsage>>>;
interface Props { id: string; name: string; onClose: () => void }

async function read(url: string): Promise<Usage> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not read usage");
    return await response.json();
  } catch {
    throw new Error("Could not read usage");
  }
}

export default function AdminUsageDialog({ id, name, onClose }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const { data, error, mutate } = useSWR(`/api/admin/restaurants/usage?id=${encodeURIComponent(id)}`, read);
  const money = (amount: number, currency: string | null): string => currency
    ? formatMoney(amount, currency) : `${t("attribution.currencyUnknown")} ${amount.toFixed(2)}`;
  return <Modal open onClose={onClose} maxWidth={600} title={t("admin.usageTitle", { name })}>
    {error ? <p>{t("admin.usageError")} <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => void mutate()}>{t("admin.usageRetry")}</button></p>
      : !data ? <p>{t("admin.usageLoading")}</p> : <>
        <p>{t("admin.usageStaff")}: <strong>{data.staff}</strong><br />
          {t("admin.usageLastActivity")}: <strong>{data.lastActivity ? new Date(data.lastActivity).toLocaleString(dateLocale(locale), { timeZone: "America/Mexico_City" }) : "—"}</strong></p>
        <p className="tt-muted">{t("admin.usageHelp")}</p>
        {([ ["admin.usageLast30", data.last30], ["admin.usageMonth", data.month] ] as const).map(([label, period]) => <section key={label}>
          <h3>{t(label)}</h3>
          <p>{t("admin.usageOrders")}: <strong>{period.orders}</strong></p>
          <p>{t("admin.usageSales")}: {period.sales.length ? period.sales.map(v => <strong key={v.currency}>{money(v.amount, v.currency)} </strong>) : "—"}</p>
          <p>{t("admin.usageTips")}: {period.tips.length ? period.tips.map(v => <strong key={v.currency}>{money(v.amount, v.currency)} </strong>) : "—"}</p>
          <p>{t("admin.usageFees")}: {period.fees.length ? period.fees.map(v => <strong key={v.currency ?? "unknown"}>{money(v.amount, v.currency)} </strong>) : "—"}</p>
          <p>{t("admin.usagePayments")}: {period.payments.length ? period.payments.map(v => <span key={v.currency}><br />{t("admin.usageCash")}: <strong>{money(v.cash, v.currency)}</strong> · {t("admin.usageCard")}: <strong>{money(v.card, v.currency)}</strong></span>) : "—"}</p>
        </section>)}
      </>}
    <div className="tt-prodform-actions"><button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onClose}>{t("admin.usageClose")}</button></div>
  </Modal>;
}
