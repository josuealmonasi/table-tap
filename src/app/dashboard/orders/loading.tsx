import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/** Shaped like the orders board: stats header, Live/History tabs, order cards. */
export default function OrdersLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.orders" }]}
          />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Skeleton width={64} height={44} radius={12} />
            <Skeleton width={96} height={44} radius={12} />
          </div>
        </header>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Skeleton width={80} height={38} radius={999} />
          <Skeleton width={80} height={38} radius={999} />
        </div>

        <div className="tt-orders-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="tt-order-card"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Skeleton width="45%" height={18} />
                <Skeleton width={72} height={22} radius={999} />
              </div>
              <Skeleton width="100%" height={56} radius={8} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Skeleton width="30%" height={16} />
                <Skeleton width={96} height={30} radius={8} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
