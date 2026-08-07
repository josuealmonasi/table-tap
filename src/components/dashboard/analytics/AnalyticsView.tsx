"use client";

import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { PERIODS, type Analytics, type Period } from "@/lib/analytics";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";

interface AnalyticsViewProps {
  data: Analytics;
  period: Period;
  currency: string;
}

/** Read-only analytics dashboard: stat tiles, revenue-by-day, top items, hours. */
const PERIOD_KEY: Record<string, string> = {
  today: "analytics.periodToday",
  "7d": "analytics.period7d",
  "30d": "analytics.period30d",
  month: "analytics.periodMonth",
};

export default function AnalyticsView({ data, period, currency }: AnalyticsViewProps) {
  const t = useT();
  const maxDay = Math.max(1, ...data.byDay.map(d => d.revenue));
  const maxHour = Math.max(1, ...data.byHour.map(h => h.count));
  const money = (n: number) => formatMoney(n, currency);

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.analytics" },
            ]}
          />
        </header>

        <div className="tt-board-tabs" role="tablist" style={{ marginBottom: 16 }}>
          {PERIODS.map(p => (
            <Link
              key={p.key}
              href={`/dashboard/analytics?period=${p.key}`}
              className={`tt-board-tab ${p.key === period ? "tt-board-tab-active" : ""}`}
            >
              {t(PERIOD_KEY[p.key] ?? p.label)}
            </Link>
          ))}
        </div>

        <div className="tt-analytics-tiles">
          <Tile label={t("analytics.revenue")} value={money(data.revenue)} accent />
          <Tile label={t("analytics.orders")} value={String(data.orderCount)} />
          <Tile label={t("analytics.avgTicket")} value={money(data.avgTicket)} />
          <Tile label={t("analytics.tips")} value={money(data.tips)} />
        </div>

        {/* A one-day "by day" chart is just a single full-width bar — skip it
            for Today; the busiest-hours chart below covers today's shape. */}
        {period !== "today" && (
          <div className="tt-section" style={{ marginTop: 16 }}>
            <div className="tt-section-head">
              <h3 className="tt-serif" style={{ margin: 0 }}>
                {t("analytics.revenueByDay")}
              </h3>
            </div>
            {data.revenue === 0 ? (
              <p className="tt-muted" style={{ fontSize: 13 }}>
                {t("analytics.noSales")}
              </p>
            ) : (
              <div className="tt-bars">
                {data.byDay.map((d, i) => (
                  <div
                    key={i}
                    className="tt-bar-col"
                    title={`${d.label}: ${money(d.revenue)}`}
                  >
                    <div className="tt-bar-track">
                      <div
                        className="tt-bar-fill"
                        style={{ height: `${Math.round((d.revenue / maxDay) * 100)}%` }}
                      />
                    </div>
                    <span className="tt-bar-label">{d.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="tt-section" style={{ marginTop: 16 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("analytics.mostSold")}
            </h3>
          </div>
          {data.topProducts.length === 0 ? (
            <p className="tt-muted" style={{ fontSize: 13 }}>
              {t("analytics.nothingSold")}
            </p>
          ) : (
            <div className="tt-analytics-table">
              <div className="tt-analytics-tr tt-staff-thead" aria-hidden="true">
                <span>{t("analytics.product")}</span>
                <span style={{ textAlign: "right" }}>{t("analytics.sold")}</span>
                <span style={{ textAlign: "right" }}>{t("analytics.revenue")}</span>
              </div>
              {data.topProducts.map((p, i) => (
                <div key={i} className="tt-analytics-tr">
                  <span className="tt-staff-cell">
                    {p.emoji ? `${p.emoji} ` : ""}
                    <strong>{p.name}</strong>
                  </span>
                  <span style={{ textAlign: "right" }}>{p.qty}</span>
                  <span style={{ textAlign: "right" }} className="tt-accent">
                    {money(p.revenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="tt-section" style={{ marginTop: 16 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("analytics.busiestHours")}
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {t("analytics.ordersByTime")}
            </span>
          </div>
          {data.orderCount === 0 ? (
            <p className="tt-muted" style={{ fontSize: 13 }}>
              {t("analytics.noOrdersPeriod")}
            </p>
          ) : (
            <div className="tt-bars tt-bars-hours">
              {data.byHour.map(h => (
                <div
                  key={h.hour}
                  className="tt-bar-col"
                  title={`${h.hour}:00 — ${t("analytics.ordersTip", { count: h.count })}`}
                >
                  <div className="tt-bar-track">
                    <div
                      className="tt-bar-fill"
                      style={{ height: `${Math.round((h.count / maxHour) * 100)}%` }}
                    />
                  </div>
                  {h.hour % 3 === 0 && <span className="tt-bar-label">{h.hour}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="tt-analytics-tile">
      <strong style={accent ? { color: "var(--tt-success)" } : undefined}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
