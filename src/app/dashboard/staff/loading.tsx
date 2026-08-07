import { Skeleton } from "@/components/ui/Skeleton";
import {
  FormSkeleton,
  LogRowsSkeleton,
  SectionSkeletonCard,
  StaffTableSkeleton,
} from "@/components/ui/DashSkeletons";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like the Staff page: team table + add-login form, then the activity
 * log. The .tt-cols wrapper matters — the real page is two columns from 1025px
 * up, so a stacked placeholder would rearrange the moment the data lands.
 */
export default function StaffLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Staff" }]}
          />
        </header>

        <div className="tt-cols">
          <SectionSkeletonCard headWidth={120}>
            <StaffTableSkeleton rows={3} />
            <div style={{ marginTop: 16 }}>
              <Skeleton width={130} height={15} style={{ marginBottom: 12 }} />
              <FormSkeleton fields={3} />
            </div>
          </SectionSkeletonCard>

          <SectionSkeletonCard headWidth={150}>
            <LogRowsSkeleton rows={5} />
          </SectionSkeletonCard>
        </div>
      </div>
    </div>
  );
}
