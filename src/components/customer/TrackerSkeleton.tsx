import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shaped like the tracker while its order loads.
 *
 * Opened from the menu the order has to be fetched, and a dialog that opens
 * empty and then snaps to full height is the jolt this exists to avoid.
 *
 * Every gap here was measured on the loaded screen at 375px rather than
 * guessed, because guessing is what made the first version read as one solid
 * block: the hero's three blocks were flush against each other while the real
 * headline and order code sit 4px apart, so the shimmer looked like a shape
 * the page never takes.
 */
export default function TrackerSkeleton() {
  return (
    <div aria-hidden="true">
      {/* 28px of padding, a 46px glyph, then 4px to the headline and 4px again
          to the order code — the hero's own spacing, measured, not invented.
          The hero centres by text-align, which does nothing to a block, so
          these centre themselves or they hug the left edge. */}
      <div className="tt-track-hero">
        {/* Where `.tt-back` really sits: 36px, inset 16px from both edges. */}
        <Skeleton
          width={36}
          height={36}
          radius={999}
          style={{ position: "absolute", top: 16, left: 16 }}
        />
        <Skeleton width={46} height={46} radius={10} style={{ margin: "0 auto" }} />
        <Skeleton width={190} height={24} style={{ margin: "4px auto 0" }} />
        <Skeleton width={84} height={14} style={{ margin: "4px auto 0" }} />
      </div>

      <div className="tt-track-body">
        {/* Same card, padding and step geometry as OrderStatusTimeline: a 44px
            dot with its 12px label 6px under it, joined by the 2px rule. */}
        <div className="tt-card" style={{ padding: 20 }}>
          <div className="tt-tracker">
            {[0, 1, 2].map(i => (
              <div key={i} className="tt-step-wrap">
                <div className="tt-step">
                  <Skeleton width={44} height={44} radius={999} />
                  <Skeleton width={i === 1 ? 68 : 78} height={12} />
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
            rule above it. Two lines because the shimmer cannot know how many
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

        {/* No block for the payment QR, deliberately. It only exists on an
            unpaid order and the shimmer cannot know yet, so drawing one would
            promise a 290px card that may never arrive — this app's own worst
            bug shape, and worse than the shorter jump of it appearing. */}
      </div>
    </div>
  );
}
