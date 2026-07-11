import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

export default function OrdersLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Orders" }]}
          />
        </header>

        <div className="tt-orders-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="tt-order-card"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Skeleton width="60%" height={18} />
              <Skeleton width="100%" height={60} radius={8} />
              <Skeleton width="40%" height={16} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
