import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

export default function DashboardLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Dashboard" }]} />
        </header>

        <div className="tt-tiles">
          {Array.from({ length: 3 }).map((_, i) => (
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
