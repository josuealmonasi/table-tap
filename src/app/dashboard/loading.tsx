import { Skeleton } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="tt-dash">
      <div className="tt-dash-inner">
        <header className="tt-dash-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton width={220} height={26} />
            <Skeleton width={80} height={13} />
          </div>
          <Skeleton width={90} height={36} radius={8} />
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
