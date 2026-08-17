import { Skeleton } from "@/components/ui/Skeleton";
import {
  FormSkeleton,
  ListSkeletonCard,
  SectionSkeletonCard,
} from "@/components/ui/DashSkeletons";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like Settings: Restaurant, Payments, Coupons, Tax and Ordering cards
 * inside the same .tt-cols grid the real page uses, in the same order — two
 * columns from 1025px up, one below.
 */
export default function SettingsLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.settings" }]}
          />
        </header>

        <div className="tt-cols">
          <SectionSkeletonCard headWidth={160}>
            <FormSkeleton fields={4} />
          </SectionSkeletonCard>

          <SectionSkeletonCard headWidth={110}>
            <Skeleton width="72%" height={14} />
          </SectionSkeletonCard>

          <ListSkeletonCard headWidth={120} rows={3} />

          <SectionSkeletonCard headWidth={90}>
            <FormSkeleton fields={1} />
          </SectionSkeletonCard>

          <SectionSkeletonCard headWidth={120}>
            <Skeleton width="100%" height={64} radius={12} />
          </SectionSkeletonCard>
        </div>
      </div>
    </div>
  );
}
