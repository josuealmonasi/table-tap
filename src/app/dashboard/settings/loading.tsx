import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

export default function SettingsLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]}
          />
        </header>

        <div
          className="tt-section"
          style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <Skeleton width={120} height={18} />
          <Skeleton width="100%" height={40} radius={10} />
          <Skeleton width="100%" height={40} radius={10} />
          <Skeleton width="100%" height={40} radius={10} />
          <Skeleton width={140} height={36} radius={10} />
        </div>
      </div>
    </div>
  );
}
