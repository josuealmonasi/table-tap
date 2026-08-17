import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/** Shaped like the analytics page: period pills, stat tiles, chart + table cards. */
export default function AnalyticsLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.analytics" }]}
          />
        </header>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width={80} height={38} radius={999} />
          ))}
        </div>

        <div className="tt-analytics-tiles">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={72} radius={16} />
          ))}
        </div>

        <div className="tt-section">
          <Skeleton width={140} height={18} style={{ marginBottom: 14 }} />
          <Skeleton width="100%" height={140} radius={12} />
        </div>

        <div className="tt-section">
          <Skeleton width={160} height={18} style={{ marginBottom: 14 }} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 4px" }}>
              <Skeleton width="40%" height={14} />
              <Skeleton width={60} height={14} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
