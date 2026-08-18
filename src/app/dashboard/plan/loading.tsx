import { Skeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";

/**
 * Shaped like the plan screen: the current-plan card, four usage rows with
 * their bars, then the tier grid — which is one column on a phone, two from
 * 700px and four from 1025px, so it borrows the real class rather than
 * guessing a shape that only matches on one screen.
 */
/** Carta, Servicio, Casa, Grupo — what each card actually holds. */
const TIER_SHAPES = [
  { lines: 2, button: false },
  { lines: 3, button: true },
  { lines: 5, button: true },
  { lines: 5, button: false },
];

export default function PlanLoading() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.plan" }]}
          />
        </header>

        {/* Mirrors the real card element for element — heading, then the name
            and price sharing a row, then the status line, then the billing
            button — rather than approximating it, which had this card 70px
            taller than what replaced it. */}
        <div className="tt-section">
          <div className="tt-section-head">
            <Skeleton width={90} height={19} />
          </div>
          <div className="tt-plan-now">
            <Skeleton width={110} height={28} />
            <Skeleton width={104} height={26} />
          </div>
          <div className="tt-plan-state">
            <Skeleton width={150} height={16} />
          </div>
          <Skeleton width={209} height={40} radius={999} style={{ marginTop: 12 }} />
        </div>

        <div className="tt-section">
          <div className="tt-section-head">
            <Skeleton width={140} height={19} />
          </div>
          <div className="tt-usage-list">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="tt-usage-row">
                <div className="tt-row">
                  <Skeleton width={i % 2 ? 120 : 74} height={17} />
                  <Skeleton width={86} height={17} />
                </div>
                {/* A bar only where there is a ceiling to fill. The entry paid
                    tier bounds tables, staff and menus and leaves dishes
                    unlimited, which is the shape most will see. */}
                {i < 3 && (
                  <Skeleton width="100%" height={6} radius={999} style={{ marginTop: 6 }} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="tt-section">
          <div className="tt-section-head">
            <Skeleton width={70} height={19} />
          </div>
          {/* The catalogue is four fixed tiers, so the shimmer knows their
              shape rather than drawing four identical guesses: Carta lists
              two things and ends in a note, Servicio three and a button,
              Casa and Grupo five. Four uniform cards left this block 58px
              taller than what replaced it. */}
          <div className="tt-tier-grid">
            {TIER_SHAPES.map((shape, i) => (
              <div key={i} className="tt-tier">
                <div className="tt-tier-head">
                  <Skeleton width={82} height={21} />
                </div>
                <Skeleton width={112} height={26} />
                <Skeleton width={128} height={15} />
                <div className="tt-tier-list">
                  {Array.from({ length: shape.lines }).map((_, j) => (
                    <Skeleton key={j} width={`${64 + ((i + j) % 3) * 12}%`} height={16} />
                  ))}
                </div>
                {shape.button ? (
                  <Skeleton width="100%" height={40} radius={999} />
                ) : (
                  <Skeleton width="72%" height={15} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
