import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like the analytics page: period pills, stat tiles, chart + table
 * cards — the tiles measured against the real ones at 390, 820 and 1280px.
 */
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
            <Skeleton key={i} width={80} height={33} radius={999} />
          ))}
        </div>

        {/* The real tile, with placeholders where its figure and label go. The
            figure is sized by its tile, so its placeholder is sized in em and
            takes the same size the figure will; no fixed height could match
            it at every width. */}
        <div className="tt-analytics-tiles" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="tt-analytics-tile">
              {/* A div, not the Skeleton's span: `.tt-analytics-tile span`
                  sets 13px on every span in a tile, and would shrink this
                  to the label's size. */}
              <strong><div className="tt-skeleton" style={{ width: "70%", height: "1.1em" }} /></strong>
              <span><Skeleton width="45%" height={14} /></span>
            </div>
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
