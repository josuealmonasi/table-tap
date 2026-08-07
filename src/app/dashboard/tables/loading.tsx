import { Skeleton } from "@/components/ui/Skeleton";
import { QrCardSkeleton, SectionSkeletonCard } from "@/components/ui/DashSkeletons";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like Tables & QR: the restaurant-wide QR card, then the per-table
 * list. Both sections are full width on every breakpoint, and each row is a
 * real .tt-qr-card, so the placeholder follows the same grid the tables do.
 */
export default function TablesLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Tables & QR" }]}
          />
        </header>

        <SectionSkeletonCard headWidth={170}>
          <Skeleton width="60%" height={12} style={{ margin: "0 0 14px" }} />
          <QrCardSkeleton />
        </SectionSkeletonCard>

        <div style={{ marginTop: 16 }}>
          <SectionSkeletonCard headWidth={140}>
            <div className="tt-add-above" style={{ display: "flex", gap: 12 }}>
              <Skeleton width="100%" height={44} radius={10} />
              <Skeleton width={130} height={44} radius={10} />
            </div>
            <div className="tt-table-list">
              {Array.from({ length: 3 }).map((_, i) => (
                <QrCardSkeleton key={i} />
              ))}
            </div>
          </SectionSkeletonCard>
        </div>
      </div>
    </div>
  );
}
