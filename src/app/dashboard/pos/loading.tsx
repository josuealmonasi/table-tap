import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shaped like the till: the search box, the section chips, a grid of tiles
 * four across, and the sale panel beside them.
 *
 * Measured against the real screen rather than guessed — a 150px minimum tile
 * 76px tall, the same 12px gaps, four tracks from 900px up, and the panel on
 * its own — so the page does not change shape when the menu arrives.
 */
export default function PosLoading() {
  return (
    <div className="tt-dash" aria-hidden="true">
      <div className="container">
        <header className="tt-dash-head">
          <Skeleton width={72} height={30} />
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
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} height={76} radius={12} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* The sale panel: heading, the empty line, where the total will be,
              three fields and the two charge buttons stacked under them. The
              total's rule keeps its space but not its ink — a hard black line
              across a panel of grey blocks reads as a fault, not a heading. */}
          <aside className="tt-pos-cart">
            <Skeleton width={72} height={22} style={{ marginBottom: 12 }} />
            <Skeleton width={180} height={16} />
            <div className="tt-pos-total tt-pos-total-loading">
              <Skeleton width={46} height={16} />
              <Skeleton width={104} height={26} />
            </div>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ marginBottom: 12 }}>
                <Skeleton width={124} height={13} style={{ marginBottom: 6 }} />
                <Skeleton height={38} radius={10} />
              </div>
            ))}
            <div className="tt-pos-charge">
              <Skeleton height={40} radius={999} />
              <Skeleton height={40} radius={999} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
