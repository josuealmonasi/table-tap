import { ListSkeletonCard } from "@/components/ui/DashSkeletons";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like Promotions: the combos list, the quantity deals below it, and
 * coupons last — three bordered lists, which is what the page settles into
 * once its data arrives.
 */
export default function PromotionsLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.promos" }]}
          />
        </header>

        <ListSkeletonCard headWidth={120} rows={2} />
        <div style={{ marginTop: 16 }}>
          <ListSkeletonCard headWidth={190} rows={2} />
        </div>
        <div style={{ marginTop: 16 }}>
          <ListSkeletonCard headWidth={110} rows={3} />
        </div>
      </div>
    </div>
  );
}
