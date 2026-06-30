import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

export default function DashboardLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Dashboard" }]} />
        </header>

        <div className="tt-section" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton width={120} height={18} />
          <Skeleton width="100%" height={44} radius={12} />
          <Skeleton width="100%" height={44} radius={12} />
        </div>

        <div className="tt-tiles" style={{ marginTop: 16 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="tt-skel-tile" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton width={34} height={34} radius={8} />
              <Skeleton width="50%" height={16} />
              <Skeleton width="80%" height={12} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
