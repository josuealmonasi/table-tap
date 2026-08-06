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
