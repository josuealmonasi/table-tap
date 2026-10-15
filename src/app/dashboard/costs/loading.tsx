import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like the margins tab: two tab pills, the intro, the period's four
 * tiles, the fee card and the first rows of products.
 */
export default function CostsLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.costs" }]} />
        </header>

        <div style={{ display: "flex", gap: 8 }}>
          <Skeleton width={96} height={37} radius={999} />
          <Skeleton width={112} height={37} radius={999} />
        </div>

        <div>
          <Skeleton width="100%" height={13} style={{ marginBottom: 6 }} />
          <Skeleton width="70%" height={13} />
        </div>

        <div>
          <Skeleton width={120} height={20} style={{ marginBottom: 8 }} />
          {/* The real tile, with placeholders where its figure and label go —
              see the analytics skeleton for why the figure is sized in em. */}
          <div className="tt-analytics-tiles" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="tt-analytics-tile">
                <strong><div className="tt-skeleton" style={{ width: "70%", height: "1.1em" }} /></strong>
                <span><Skeleton width="45%" height={14} /></span>
              </div>
            ))}
          </div>
        </div>

        <div className="tt-section">
          <Skeleton width={220} height={20} style={{ marginBottom: 10 }} />
          <Skeleton width="90%" height={13} style={{ marginBottom: 6 }} />
          <Skeleton width="80%" height={13} style={{ marginBottom: 12 }} />
          <Skeleton width={260} height={44} radius={8} />
        </div>

        <div className="tt-section">
          <Skeleton width={120} height={20} style={{ marginBottom: 10 }} />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={62} radius={8} style={{ marginBottom: 6 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
