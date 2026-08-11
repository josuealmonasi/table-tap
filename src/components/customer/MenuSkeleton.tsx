import { MenuItemRowSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * Shaped like the customer menu while it loads.
 *
 * It borrows the real layout classes rather than drawing its own boxes, so it
 * inherits the same breakpoints for free: below 1025px a chip row above a
 * stacked list, above it a 220px sidebar beside a two-column grid. Drawing only
 * the dish cards left the desktop sidebar with nothing holding its place, so it
 * popped in when the data landed and shoved the grid sideways.
 *
 * @param table a table-scoped menu also shows a table badge and service buttons
 */
export default function MenuSkeleton({ table = false }: { table?: boolean }) {
  return (
    <div className="tt-root tt-root-wide">
      <div className="tt-menu-header">
        <div className="tt-row" style={{ alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton width={26} height={26} radius={6} />
            <Skeleton width={160} height={20} />
            <Skeleton width={120} height={12} />
          </div>
          {/* Search and language sit opposite the name at every width. */}
          <div className="tt-head-controls">
            <div style={{ display: "flex", gap: 8 }}>
              <Skeleton width={34} height={34} radius={999} />
              <Skeleton width={72} height={34} radius={999} />
            </div>
          </div>
        </div>
        {table && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Skeleton width={96} height={26} radius={999} />
            <Skeleton width={110} height={26} radius={999} />
          </div>
        )}
      </div>

      {/* Phone and tablet only — the real strip is hidden from 1025px up, where
          the sidebar takes over. Without the class it showed on desktop too. */}
      <div className="tt-menu-sticky">
        <div className="tt-cats">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width={70} height={30} radius={999} />
          ))}
        </div>
      </div>

      <div className="tt-dish-layout">
        {/* Desktop only, by the same rule as the real one: categories, then the
            dietary filter group beneath. */}
        <aside className="tt-dish-side">
          <div className="tt-side-nav">
            {/* The real links sit flush with 9px of padding and show a category
                name, so full-width bars merged into one blob. Text-width bars
                inside the same padding read as the list they replace. */}
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ padding: "9px 12px" }}>
                <Skeleton width={`${46 + ((i * 17) % 38)}%`} height={14} />
              </div>
            ))}
          </div>
          <div className="tt-side-group">
            <Skeleton width={90} height={13} />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} width={`${60 + ((i * 13) % 32)}%`} height={16} />
            ))}
          </div>
        </aside>

        {/* .tt-dish-list is a two-column grid on desktop and a stacked list on a
            phone — exactly what replaces it. Eight rows fill both columns above
            the fold; the surplus scrolls off on a narrow screen. */}
        <div className="tt-dish-list">
          {Array.from({ length: 8 }).map((_, i) => (
            <MenuItemRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
