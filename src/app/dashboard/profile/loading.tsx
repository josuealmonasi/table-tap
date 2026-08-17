import { FormSkeleton, SectionSkeletonCard } from "@/components/ui/DashSkeletons";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like Your profile: the name card, then email, then password — three
 * short forms, each one field and a button.
 */
export default function ProfileLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.profile" }]}
          />
        </header>

        {[130, 110, 150].map((head, i) => (
          // The real cards are capped at 520px; a full-width shimmer would
          // snap in when the page arrives.
          <div key={head} style={{ maxWidth: 520, marginTop: i === 0 ? 0 : 16 }}>
            <SectionSkeletonCard headWidth={head}>
              <FormSkeleton fields={1} />
            </SectionSkeletonCard>
          </div>
        ))}
      </div>
    </div>
  );
}
