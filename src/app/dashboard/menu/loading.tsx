import { Skeleton, SectionSkeleton } from "@/components/ui/Skeleton";

export default function MenuLoading() {
  return (
    <div className="tt-dash">
      <div className="tt-dash-inner">
        <header className="tt-dash-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton width={120} height={26} />
            <Skeleton width={160} height={13} />
          </div>
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
