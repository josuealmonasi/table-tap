import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { PERIODS, type Analytics, type Period } from "@/lib/analytics";
import Breadcrumb from "@/components/layout/Breadcrumb";

interface AnalyticsViewProps {
  data: Analytics;
  period: Period;
  currency: string;
}

/** Read-only analytics dashboard: stat tiles, revenue-by-day, top items, hours. */
export default function AnalyticsView({ data, period, currency }: AnalyticsViewProps) {
  const maxDay = Math.max(1, ...data.byDay.map(d => d.revenue));
  const maxHour = Math.max(1, ...data.byHour.map(h => h.count));
  const money = (n: number) => formatMoney(n, currency);

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Analytics" }]}
          />
        </header>

        <div className="tt-board-tabs" role="tablist" style={{ marginBottom: 16 }}>
          {PERIODS.map(p => (
            <Link
              key={p.key}
              href={`/dashboard/analytics?period=${p.key}`}
              className={`tt-board-tab ${p.key === period ? "tt-board-tab-active" : ""}`}
            >
              {p.label}
            </Link>
          ))}
        </div>

        <div className="tt-analytics-tiles">
          <Tile label="Revenue" value={money(data.revenue)} accent />
          <Tile label="Orders" value={String(data.orderCount)} />
          <Tile label="Avg ticket" value={money(data.avgTicket)} />
          <Tile label="Tips" value={money(data.tips)} />
        </div>

        <div className="tt-section" style={{ marginTop: 16 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>Revenue by day</h3>
          </div>
          {data.revenue === 0 ? (
            <p className="tt-muted" style={{ fontSize: 13 }}>No sales in this period yet.</p>
          ) : (
            <div className="tt-bars">
              {data.byDay.map((d, i) => (
                <div key={i} className="tt-bar-col" title={`${d.label}: ${money(d.revenue)}`}>
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

        <div className="tt-section" style={{ marginTop: 16 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>Most sold products</h3>
          </div>
          {data.topProducts.length === 0 ? (
            <p className="tt-muted" style={{ fontSize: 13 }}>Nothing sold yet.</p>
          ) : (
            <div className="tt-analytics-table">
              <div className="tt-analytics-tr tt-staff-thead" aria-hidden="true">
                <span>Product</span>
                <span style={{ textAlign: "right" }}>Sold</span>
                <span style={{ textAlign: "right" }}>Revenue</span>
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
            <h3 className="tt-serif" style={{ margin: 0 }}>Busiest hours</h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>Orders by time of day</span>
          </div>
          {data.orderCount === 0 ? (
            <p className="tt-muted" style={{ fontSize: 13 }}>No orders in this period yet.</p>
          ) : (
            <div className="tt-bars tt-bars-hours">
              {data.byHour.map(h => (
                <div key={h.hour} className="tt-bar-col" title={`${h.hour}:00 — ${h.count} orders`}>
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

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="tt-analytics-tile">
      <strong style={accent ? { color: "var(--tt-success)" } : undefined}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
