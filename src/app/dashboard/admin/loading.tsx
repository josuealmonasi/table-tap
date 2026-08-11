import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/** Loading state shaped like the admin view: two tables of rows, not menus. */
export default function AdminLoading() {
  const rows = (n: number) =>
    Array.from({ length: n }).map((_, i) => (
      <div
        key={i}
        style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 4px" }}
      >
        <Skeleton width="28%" height={14} />
        <Skeleton width="34%" height={12} />
        <Skeleton width={90} height={20} radius={999} />
        <Skeleton width="18%" height={12} />
      </div>
    ));

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "admin.title" }]} />
        </header>

        <div className="tt-section">
          <Skeleton width={140} height={18} style={{ marginBottom: 12 }} />
          {rows(4)}
        </div>

        <div className="tt-section" style={{ marginTop: 16 }}>
          <Skeleton width={100} height={18} style={{ marginBottom: 12 }} />
          {rows(6)}
        </div>
      </div>
    </div>
  );
}
