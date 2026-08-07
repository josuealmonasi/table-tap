/** A shimmering placeholder block. Width/height/radius are CSS values (e.g. "60%", "14px"). */
export function Skeleton({
  width = "100%",
  height = "14px",
  radius,
  style,
}: {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="tt-skeleton"
      style={{ display: "block", width, height, borderRadius: radius, ...style }}
    />
  );
}

/** Mimics one .tt-prod row: thumb + two text lines + a price-shaped block. */
export function ProductRowSkeleton() {
  return (
    <div className="tt-prod">
      <Skeleton width={48} height={48} radius={10} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton width="40%" />
        <Skeleton width="65%" height={11} />
      </div>
      <Skeleton width={56} height={16} />
    </div>
  );
}

/** Mimics one .tt-section card with a heading and a few product rows. */
export function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <Skeleton width={140} height={18} />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <ProductRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Mimics one .tt-item row on the customer menu — text left, square image
 * right. It has to use the real .tt-item class rather than its own layout, or
 * the skeleton stays in the old shape when the row changes and the page
 * visibly re-flows the moment the data lands. That also gets the desktop
 * grid for free, since .tt-dish-list lays these out identically.
 */
export function MenuItemRowSkeleton() {
  return (
    <div className="tt-item">
      <div
        className="tt-item-body"
        style={{ display: "flex", flexDirection: "column", gap: 7 }}
      >
        <Skeleton width="55%" height={15} />
        <Skeleton width={64} height={15} />
        <Skeleton width="85%" height={12} />
      </div>
      <div className="tt-item-media">
        <Skeleton width="100%" height="100%" radius={8} />
      </div>
    </div>
  );
}

/**
 * Placeholder rows for a list that's still fetching.
 *
 * The word "Loading…" tells you the app is busy but not what's coming, so the
 * layout jumps the moment it arrives. A shimmer in the shape of the rows keeps
 * the page still and reads as content on its way.
 */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            border: "1px solid var(--tt-line)",
            borderRadius: "var(--tt-radius)",
          }}
        >
          <Skeleton width={32} height={32} radius={8} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton width={`${52 + ((i * 13) % 26)}%`} height={13} />
            <Skeleton width={`${30 + ((i * 17) % 22)}%`} height={11} />
          </div>
          <Skeleton width={54} height={22} radius={999} />
        </div>
      ))}
    </div>
  );
}
