import { ListSkeleton, Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Skeleton width={200} height={20} />
          <Skeleton width={160} height={34} radius={10} />
        </header>
        <section className="tt-section">
          <Skeleton width="70%" height={14} style={{ marginBottom: 12 }} />
          <ListSkeleton rows={3} />
        </section>
      </div>
    </div>
  );
}
