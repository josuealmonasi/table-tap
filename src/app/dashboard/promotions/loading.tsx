import { ListSkeleton, Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like Promotions: the two "new…" buttons, then the promotions list and
 * the coupons list side by side — one column each on a wide screen, stacked on
 * a phone, which is what the grid does with them once they arrive.
 */
export default function PromotionsLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.promos" }]}
          />
        </header>

        <div className="tt-cols">
          <div className="tt-section" aria-hidden="true">
            <div className="tt-section-head">
              <Skeleton width={120} height={18} />
            </div>
            <Skeleton width="85%" height={12} style={{ margin: "6px 0 12px" }} />
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <Skeleton width={140} height={32} radius={999} />
              <Skeleton width={175} height={32} radius={999} />
            </div>
            <ListSkeleton rows={3} />
          </div>
          <div className="tt-section" aria-hidden="true">
            <div className="tt-section-head">
              <Skeleton width={110} height={18} />
            </div>
            <Skeleton width="90%" height={12} style={{ margin: "6px 0 12px" }} />
            <Skeleton width={150} height={32} radius={999} style={{ marginBottom: 14 }} />
            <ListSkeleton rows={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
