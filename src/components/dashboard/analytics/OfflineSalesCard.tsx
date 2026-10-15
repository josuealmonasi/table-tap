"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { orderCode } from "@/lib/types";
import { useWhen } from "@/hooks/useWhen";

export interface OfflineSaleRow {
  id: string;
  offline_at: string;
  total: number;
  /** What was collected less what the menu prices it at; null when it could not be priced. */
  offline_drift: number | null;
}

interface OfflineSalesCardProps {
  sales: OfflineSaleRow[];
  currency: string;
  timeZone: string;
}

/**
 * The sales the till rang without a connection in the last two weeks, each
 * at the time it happened and for what was collected. One whose amount is
 * not what the menu prices it at — the menu moved during the outage, or a
 * dish was gone by the time it was sent — is marked, for a manager to look
 * at: the corte follows the drawer, and this is where the difference shows.
 */
export default function OfflineSalesCard({ sales, currency, timeZone }: OfflineSalesCardProps) {
  const t = useT();
  const when = useWhen(timeZone);
  const money = (n: number) => formatMoney(n, currency);
  const flagged = sales.filter(s => s.offline_drift === null || Math.abs(s.offline_drift) >= 0.01);
  return (
    <section className="tt-section">
      <h3 className="tt-serif" style={{ margin: 0 }}>{t("offlineSales.title")}</h3>
      <p className="tt-muted tt-costs-hint">
        {t("offlineSales.hint", { n: sales.length })}
        {flagged.length > 0 && ` ${t("offlineSales.flagged", { n: flagged.length })}`}
      </p>
      <ul className="tt-costs-products">
        {sales.map(s => (
          <li key={s.id} className="tt-costs-entry">
            <span className="tt-costs-product-name">{orderCode(s.id)}</span>
            <span className="tt-costs-margin">{money(s.total)}</span>
            <span className="tt-costs-product-meta tt-muted">
              {when(s.offline_at)}
              {s.offline_drift === null
                ? ` · ${t("offlineSales.unpriced")}`
                : Math.abs(s.offline_drift) >= 0.01
                  ? ` · ${t("offlineSales.drift", { amount: money(s.offline_drift) })}`
                  : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
