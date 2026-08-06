import { Skeleton, MenuItemRowSkeleton } from "@/components/ui/Skeleton";

export default function TableMenuLoading() {
  return (
    <div className="tt-root tt-root-wide">
      <div className="tt-menu-header">
        <div className="tt-row" style={{ alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton width={26} height={26} radius={6} />
            <Skeleton width={160} height={20} />
            <Skeleton width={120} height={12} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "16px 0" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width={70} height={28} radius={20} />
          ))}
        </div>
      </div>

      {/* .tt-dish-list, so the placeholder is a two-column grid on desktop and
          a stacked list on a phone — exactly what replaces it. Eight rows fill
          both columns above the fold on a wide screen; the surplus simply
          scrolls off on a narrow one. */}
      <div style={{ padding: 16 }}>
        <div className="tt-dish-list">
          {Array.from({ length: 8 }).map((_, i) => (
            <MenuItemRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
