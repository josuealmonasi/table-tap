import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like the visit card page, block for block, measured off the real one
 * at 360, 390, 820 and 1280px: the banner that says whether the card is on,
 * the program — its hint, the switch, the goal and its two notes, the reward,
 * the save button — the card as a diner gets it, and the card lookup with its
 * scanner. The hints wrap to a different number of lines at each width
 * (`.tt-loyalty-skel-*` holds those heights), and the header keeps room for
 * "Sellar tarjeta", which is there whenever the card is switched on.
 */
export default function LoyaltyLoading() {
  const gap = (px: number) => <div style={{ height: px }} />;
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.loyalty" }]} />
          <Skeleton width={120} height={30} radius={8} />
        </header>
        <div className="tt-loyalty-skel-status" aria-hidden="true"><Skeleton height="100%" radius={12} /></div>
        <div className="tt-cols">
          <div className="tt-loyalty-col" aria-hidden="true">
          <div className="tt-section">
            <div className="tt-section-head">
              <Skeleton width={160} height={26} />
            </div>
            <div className="tt-loyalty-skel-hint"><Skeleton height="100%" /></div>
            {gap(13)}
            <Skeleton height={52} radius={12} />
            {gap(16)}
            <Skeleton width={180} height={15} />
            {gap(6)}
            <Skeleton width={120} height={40} />
            {gap(12)}
            <div className="tt-loyalty-skel-note"><Skeleton height="100%" /></div>
            {gap(12)}
            <div className="tt-loyalty-skel-round"><Skeleton height="100%" /></div>
            {gap(16)}
            <Skeleton width={90} height={15} />
            {gap(6)}
            <Skeleton height={40} />
            {gap(16)}
            <Skeleton width={96} height={40} radius={999} />
          </div>
          <div className="tt-section">
            <div className="tt-section-head">
              <Skeleton width={200} height={26} />
            </div>
            <div className="tt-loyalty-skel-note"><Skeleton height="100%" /></div>
            {gap(13)}
            <div className="tt-loyalty-skel-card"><Skeleton height="100%" radius={12} /></div>
          </div>
          </div>
          <div className="tt-section" aria-hidden="true">
            <div className="tt-section-head">
              <Skeleton width={180} height={26} />
            </div>
            <Skeleton height={46} />
            {gap(10)}
            <Skeleton width={90} height={30} radius={999} />
            {gap(13)}
            <div className="tt-loyalty-skel-note"><Skeleton height="100%" /></div>
            {gap(13)}
          </div>
        </div>
      </div>
    </div>
  );
}
