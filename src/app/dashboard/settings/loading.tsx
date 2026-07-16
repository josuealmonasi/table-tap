import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/** Shaped like the Settings page: a Restaurant card and an Ordering card. */
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
          <Skeleton width={160} height={18} />
          <div style={{ display: "flex", gap: 12 }}>
            <Skeleton width="100%" height={40} radius={10} />
            <Skeleton width={80} height={40} radius={10} />
          </div>
          <Skeleton width="100%" height={40} radius={10} />
          <Skeleton width={200} height={40} radius={10} />
          <Skeleton width="100%" height={64} radius={12} />
          <Skeleton width={140} height={36} radius={10} style={{ alignSelf: "flex-end" }} />
        </div>

        <div
          className="tt-section"
          style={{ maxWidth: 520, marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <Skeleton width={100} height={18} />
          <Skeleton width="100%" height={64} radius={12} />
        </div>
      </div>
    </div>
  );
}
