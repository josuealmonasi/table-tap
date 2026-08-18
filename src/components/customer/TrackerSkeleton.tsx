import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shaped like the tracker while its order loads.
 *
 * Opened from the menu the order has to be fetched, and a dialog that opens
 * empty and then snaps to full height is the jolt this exists to avoid. Every
 * block below is measured against the real one: the ink hero, the stage card,
 * the items card and the button under it.
 */
export default function TrackerSkeleton() {
  return (
    <div aria-hidden="true">
      {/* 28px of padding, a 46px glyph, the headline flush under it, then the
          order code 4px below — the hero's own spacing, not invented gaps. */}
      {/* The hero centres its contents by text-align, which does nothing to a
          block — these have to centre themselves or they hug the left edge. */}
      <div className="tt-track-hero">
        <Skeleton width={46} height={46} radius={10} style={{ margin: "0 auto" }} />
        <Skeleton width={190} height={28} style={{ margin: "0 auto" }} />
        <Skeleton width={84} height={16} style={{ margin: "4px auto 0" }} />
      </div>

      <div className="tt-track-body">
        {/* Same card, padding and step geometry as OrderStatusTimeline: a 44px
            dot with its 11px label 6px under it, joined by the 2px rule. */}
        <div className="tt-card" style={{ padding: 20 }}>
          <div className="tt-tracker">
            {[0, 1, 2].map(i => (
              <div key={i} className="tt-step-wrap">
                <div className="tt-step">
                  <Skeleton width={44} height={44} radius={999} />
                  <Skeleton width={i === 1 ? 68 : 78} height={13} />
                </div>
                {i < 2 && <div className="tt-step-line" />}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
            <Skeleton width={186} height={16} />
          </div>
        </div>

        {/* The items card, borrowing its own classes so the spacing can't
            drift: the heading, then dish lines, then the total row with its
            rule above it. Two lines because the shimmer can't know how many
            were ordered, and two is the order most tables place. */}
        <div className="tt-card" style={{ padding: 16, marginTop: 16 }}>
          <Skeleton width={104} height={18} />
          <div style={{ marginTop: 12 }}>
            <Skeleton width="100%" height={19} style={{ marginBottom: 8 }} />
            <Skeleton width="100%" height={19} />
          </div>
          <div className="tt-row tt-total">
            <Skeleton width={104} height={20} />
            <Skeleton width={92} height={20} />
          </div>
        </div>

        {/* The full-width ghost button that goes back to the menu. */}
        <Skeleton width="100%" height={40} radius={999} style={{ marginTop: 12 }} />
      </div>
    </div>
  );
}
