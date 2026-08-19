import { Skeleton } from "@/components/ui/Skeleton";
import { SectionSkeletonCard } from "@/components/ui/DashSkeletons";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like Open bills: the search pill, then a row per bill.
 *
 * Each placeholder row is a real `.tt-bill-row`, so the glyph, the two lines
 * of text and the amount land exactly where the loaded page puts them and the
 * list doesn't shift under the manager's finger when it arrives. Without this
 * file the route fell back to the dashboard's own skeleton — a grid of nav
 * tiles, which is not this page at all.
 *
 * The real row wraps onto a second line — etiqueta e importe debajo del
 * nombre — so the placeholder carries those two blocks as well. A shimmer one
 * line shorter than what replaces it is a shimmer that lies.
 */
export default function BillsLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.bills" }]}
          />
        </header>

        <SectionSkeletonCard headWidth={130}>
          <Skeleton width="55%" height={12} style={{ margin: "0 0 12px" }} />
          <Skeleton width="100%" height={43} radius={999} />

          <div className="tt-bill-list">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="tt-bill-row" aria-hidden="true">
                <div className="tt-bill-open-main">
                  <Skeleton width={34} height={34} radius={999} />
                  <div className="tt-bill-main" style={{ gap: 6 }}>
                    <Skeleton width={110} height={15} />
                    <Skeleton width={150} height={12} />
                  </div>
                  <Skeleton width={110} height={20} radius={999} />
                  <Skeleton width={78} height={16} />
                </div>
                <Skeleton width={73} height={30} radius={999} />
              </div>
            ))}
          </div>
        </SectionSkeletonCard>
      </div>
    </div>
  );
}
