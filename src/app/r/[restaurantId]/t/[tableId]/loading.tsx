import { Skeleton, MenuItemRowSkeleton } from "@/components/ui/Skeleton";

export default function TableMenuLoading() {
  return (
    <div className="tt-root">
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

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <MenuItemRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
