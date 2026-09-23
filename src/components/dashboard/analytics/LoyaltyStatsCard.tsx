"use client";

import { useT } from "@/lib/i18n/context";
import type { LoyaltyStats } from "@/lib/loyalty/analytics";

interface LoyaltyStatsCardProps {
  stats: LoyaltyStats;
}

/**
 * The visit card over the period the charts are showing: cards made, visits
 * stamped, cards that came back on another day, and rewards spent — then the
 * stamps each person gave, which is where a stamp with nothing sold behind it
 * would show.
 */
export default function LoyaltyStatsCard({ stats }: LoyaltyStatsCardProps) {
  const t = useT();
  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>{t("analytics.loyaltyTitle")}</h3>
      </div>
      <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>{t("analytics.loyaltyHint")}</p>
      <div className="tt-analytics-tiles">
        <div className="tt-analytics-tile"><strong>{stats.cardsMade}</strong><span>{t("analytics.loyaltyCards")}</span></div>
        <div className="tt-analytics-tile"><strong>{stats.visits}</strong><span>{t("analytics.loyaltyVisits")}</span></div>
        <div className="tt-analytics-tile"><strong>{stats.cameBack}</strong><span>{t("analytics.loyaltyBack")}</span></div>
        <div className="tt-analytics-tile"><strong>{stats.rewards}</strong><span>{t("analytics.loyaltyRewards")}</span></div>
      </div>
      {stats.byStaff.length === 0 ? (
        <p className="tt-muted" style={{ fontSize: 13 }}>{t("analytics.loyaltyNone")}</p>
      ) : (
        <>
          <h4 className="tt-loyalty-subhead">{t("analytics.loyaltyByStaff")}</h4>
          <ul className="tt-loyalty-list">
            {stats.byStaff.map(s => (
              <li key={s.actor}>
                <span>{s.actor}</span>
                <strong>{s.stamps}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
