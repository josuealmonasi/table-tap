import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/** Shaped like the Staff page: team table, add-login form, activity log. */
export default function StaffLoading() {
  const row = (i: number) => (
    <div
      key={i}
      style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 4px" }}
    >
      <Skeleton width="30%" height={14} />
      <Skeleton width="34%" height={12} />
      <Skeleton width={70} height={20} radius={999} />
      <Skeleton width={20} height={20} />
    </div>
  );

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Staff" }]}
          />
        </header>

        <div className="tt-section" style={{ maxWidth: 560 }}>
          <Skeleton width={140} height={18} style={{ marginBottom: 12 }} />
          {row(0)}
          {row(1)}
          <div
            style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}
          >
            <div style={{ display: "flex", gap: 12 }}>
              <Skeleton width="100%" height={40} radius={10} />
              <Skeleton width="100%" height={40} radius={10} />
            </div>
            <Skeleton width={220} height={40} radius={10} />
            <Skeleton width={150} height={36} radius={10} style={{ alignSelf: "flex-end" }} />
          </div>
        </div>

        <div className="tt-section" style={{ maxWidth: 720, marginTop: 16 }}>
          <Skeleton width={140} height={18} style={{ marginBottom: 12 }} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", padding: "9px 4px" }}
            >
              <Skeleton width="55%" height={13} />
              <Skeleton width={80} height={12} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
