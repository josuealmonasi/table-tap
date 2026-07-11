import { SectionSkeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

export default function MenuEditorLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "…" }]}
          />
        </header>

        <div className="tt-menu-grid">
          <SectionSkeleton rows={1} />
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={2} />
        </div>
      </div>
    </div>
  );
}
