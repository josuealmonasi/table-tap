import { ListSkeleton, Skeleton } from "./Skeleton";

/**
 * Dashboard-shaped placeholders.
 *
 * Each one borrows the real component's classes rather than drawing its own
 * boxes. A hand-drawn shimmer only matches on the width it was drawn for — the
 * staff list, for instance, is a four-column grid on desktop but the generic
 * ListSkeleton stacks bordered cards, so the page visibly rearranged itself the
 * moment the data landed. Reusing the class means the placeholder follows the
 * same breakpoints the content does, on every screen, for free.
 */

/** One .tt-staff-tr: name, email, role select, delete button. */
export function StaffTableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="tt-staff-table" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="tt-staff-tr">
          <Skeleton width={`${62 + ((i * 13) % 30)}%`} height={13} />
          <Skeleton width={`${58 + ((i * 17) % 34)}%`} height={13} />
          <Skeleton width="100%" height={30} radius={8} />
          <Skeleton width={20} height={20} radius={6} />
        </div>
      ))}
    </div>
  );
}

/** Activity log lines: sentence left, timestamp right. */
export function LogRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="tt-log-row">
          <Skeleton width={`${55 + ((i * 11) % 30)}%`} height={13} />
          <Skeleton width={84} height={12} />
        </div>
      ))}
    </div>
  );
}

/** One .tt-qr-card: the 140px code square plus its label, URL and buttons. */
export function QrCardSkeleton() {
  return (
    <div className="tt-qr-card" aria-hidden="true">
      <div className="tt-qr-code">
        <Skeleton width="100%" height="100%" radius={4} />
      </div>
      <div className="tt-qr-meta" style={{ flex: 1 }}>
        <Skeleton width={170} height={16} />
        <Skeleton width={120} height={12} />
        <Skeleton width={240} height={12} style={{ maxWidth: "100%" }} />
        <div className="tt-qr-actions">
          <Skeleton width={110} height={32} radius={10} />
          <Skeleton width={80} height={32} radius={10} />
        </div>
      </div>
    </div>
  );
}

/** A .tt-section with its heading already shimmering; you supply the body. */
export function SectionSkeletonCard({
  headWidth = 150,
  children,
}: {
  headWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="tt-section" aria-hidden="true">
      <div className="tt-section-head">
        <Skeleton width={headWidth} height={18} />
      </div>
      {children}
    </div>
  );
}

/** Stacked form controls — the shape most dashboard cards settle into. */
export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: fields }).map((_, i) => (
        <Skeleton key={i} width="100%" height={40} radius={10} />
      ))}
      <Skeleton width={140} height={36} radius={10} style={{ alignSelf: "flex-end" }} />
    </div>
  );
}

/** A .tt-section whose body is a plain bordered list (coupons, promotions). */
export function ListSkeletonCard({
  headWidth = 150,
  rows = 3,
}: {
  headWidth?: number;
  rows?: number;
}) {
  return (
    <SectionSkeletonCard headWidth={headWidth}>
      <ListSkeleton rows={rows} />
    </SectionSkeletonCard>
  );
}
