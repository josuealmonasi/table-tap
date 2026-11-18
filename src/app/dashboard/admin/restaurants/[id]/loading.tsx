import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/** Shaped like the owner view: a note, a facts card, then cards of two-sided rows. */
export default function AdminOwnerViewLoading() {
  const rows = (n: number) =>
    Array.from({ length: n }).map((_, i) => (
      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0" }}>
        <Skeleton width="45%" height={14} />
        <Skeleton width="20%" height={12} />
      </div>
    ));
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "admin.title", href: "/dashboard/admin" }]} />
        </header>
        <Skeleton width="100%" height={38} style={{ marginBottom: 16 }} />
        <div className="tt-section">
          <Skeleton width={160} height={20} style={{ marginBottom: 10 }} />
          <Skeleton width="70%" height={14} />
        </div>
        {[5, 2, 4, 8].map((n, i) => (
          <div key={i} className="tt-section">
            <Skeleton width={140} height={18} style={{ marginBottom: 8 }} />
            {rows(n)}
          </div>
        ))}
      </div>
    </div>
  );
}
