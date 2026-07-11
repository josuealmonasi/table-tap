import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

export default function TablesLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Tables & QR" }]}
          />
        </header>

        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="tt-section"
            style={{
              marginTop: i ? 16 : 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <Skeleton width={140} height={18} />
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <Skeleton width={140} height={140} radius={12} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton width={160} height={16} />
                <Skeleton width={220} height={12} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
