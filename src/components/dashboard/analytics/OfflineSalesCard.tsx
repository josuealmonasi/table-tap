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
  /** Every sale rung offline in the window. */
  count: number;
  /** The window, in days: as long as a sale can arrive late, plus two weeks. */
  days: number;
  /** The ones to look at: charged differently from today's menu, or not comparable. */
  sales: OfflineSaleRow[];
  currency: string;
  timeZone: string;
}

/**
 * The sales the till rang without a connection, counted, and every one whose
 * amount is not what the menu prices it at — the menu moved during the
 * outage, or a dish was gone by the time it was sent — listed at the time it
 * happened and for what was collected, for a manager to look at: the corte
 * follows the drawer, and this is where the difference shows. Ones that match
 * the menu are only counted; a long list of them buried the few that did not.
 */
export default function OfflineSalesCard({ count, days, sales, currency, timeZone }: OfflineSalesCardProps) {
  const t = useT();
  const when = useWhen(timeZone);
  const money = (n: number) => formatMoney(n, currency);
  return (
    <section className="tt-section">
      <h3 className="tt-serif" style={{ margin: 0 }}>{t("offlineSales.title")}</h3>
      <p className="tt-muted tt-costs-hint">
        {t("offlineSales.hint", { n: count, days })}
        {sales.length > 0 && ` ${t("offlineSales.flagged", { n: sales.length })}`}
      </p>
      {sales.length > 0 && <ul className="tt-costs-products">
        {sales.map(s => (
          <li key={s.id} className="tt-costs-entry">
            <span className="tt-costs-product-name">{orderCode(s.id)}</span>
            <span className="tt-costs-margin">{money(s.total)}</span>
            <span className="tt-costs-product-meta tt-muted">
              {when(s.offline_at)}
              {s.offline_drift === null
                ? ` · ${t("offlineSales.unpriced")}`
                : ` · ${t("offlineSales.drift", { amount: money(s.offline_drift) })}`}
            </span>
          </li>
        ))}
      </ul>}
    </section>
  );
}
