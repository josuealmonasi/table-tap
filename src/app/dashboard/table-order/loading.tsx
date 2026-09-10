import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shaped like the pad: the search box, the section chips, a grid of tiles four
 * across, and the order beside them — with the table picker at its top, which
 * is the first thing a waiter reaches for.
 */
export default function TableOrderLoading() {
  return (
    <div className="tt-dash" aria-hidden="true">
      <div className="container">
        <header className="tt-dash-head">
          <Skeleton width={132} height={30} />
        </header>

        <div className="tt-pos">
          <div className="tt-pos-menu">
            <Skeleton height={40} radius={10} style={{ marginBottom: 12 }} />
            <div className="tt-pos-jump" style={{ marginBottom: 20 }}>
              {[92, 74, 108].map(w => (
                <Skeleton key={w} width={w} height={32} radius={999} />
              ))}
            </div>
            {[0, 1].map(section => (
              <div key={section} style={{ marginTop: section === 0 ? 0 : 32 }}>
                <Skeleton width={96} height={14} style={{ marginBottom: 12 }} />
                <div className="tt-pos-grid">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} height={76} radius={12} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <aside className="tt-pos-cart">
            <Skeleton width={78} height={22} style={{ marginBottom: 12 }} />
            <Skeleton width={44} height={13} style={{ marginBottom: 6 }} />
            <Skeleton height={38} radius={10} style={{ marginBottom: 14 }} />
            <Skeleton width={180} height={16} />
            {/* The rule under the total keeps its space and not its ink. */}
            <div className="tt-pos-total tt-pos-total-loading">
              <Skeleton width={46} height={16} />
              <Skeleton width={104} height={26} />
            </div>
            <div className="tt-pos-charge">
              <Skeleton height={40} radius={999} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
