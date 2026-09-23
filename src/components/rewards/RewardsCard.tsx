"use client";

import { useT } from "@/lib/i18n/context";
import type { Standing } from "@/lib/loyalty/standing";
import type { CardFace } from "@/lib/loyalty/face";
import type { QrGrid } from "@/lib/loyalty/qr-grid";
import { nextStep } from "@/lib/loyalty/next-step";
import { dateLocale } from "@/lib/format";

/** What /api/rewards answers: what the card itself would show, and no more. */
export interface CardStanding {
  face: CardFace;
  qr: QrGrid;
  restaurant: { name: string; logo: string | null; logo_url: string | null };
  active: boolean;
  reward: string;
  standing: Standing;
  memberSince: string;
  lastVisit: string | null;
  redeemed: { day: string; reward: string }[];
}

interface RewardsCardProps {
  card: CardStanding;
  locale: string;
}

/** A calendar day, in the diner's language. The day is the restaurant's, so no zone shifts it. */
function dayLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(dateLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export default function RewardsCard({ card, locale }: RewardsCardProps) {
  const t = useT();
  const { standing: s, reward } = card;
  const next = nextStep(s, reward);
  const nextLine = t(next.key, next.vars);

  return (
    <div className="tt-rewards">
      <div className="tt-rewards-head">
        {card.restaurant.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- the restaurant's own upload, any host
          <img className="tt-rewards-logo" src={card.restaurant.logo_url} alt="" />
        ) : (
          <span className="tt-rewards-logo" aria-hidden="true">
            {card.restaurant.logo ?? "🍽️"}
          </span>
        )}
        <h1 className="tt-serif tt-rewards-name">{card.restaurant.name}</h1>
      </div>

      <p className="tt-rewards-count">{t("rewards.visitsOf", { visits: s.visits, goal: s.goal })}</p>
      <div className="tt-rewards-dots" role="img" aria-label={t("rewards.visitsOf", { visits: s.visits, goal: s.goal })}>
        {Array.from({ length: s.goal }, (_, i) => (
          <span key={i} className={i < s.visits ? "tt-rewards-dot tt-rewards-dot-on" : "tt-rewards-dot"} />
        ))}
      </div>

      {s.ready && <p className="tt-rewards-ready">{t("rewards.ready")}</p>}
      <p className="tt-rewards-next">{nextLine}</p>
      {!card.active && <p className="tt-rewards-paused">{t("rewards.paused")}</p>}

      <p className="tt-muted tt-rewards-meta">
        {card.lastVisit ? t("rewards.lastVisit", { date: dayLabel(card.lastVisit, locale) }) : null}
        {card.lastVisit ? " · " : null}
        {t("rewards.memberSince", { date: dayLabel(card.memberSince, locale) })}
      </p>

      {card.redeemed.length > 0 && (
        <div className="tt-rewards-history">
          <h2 className="tt-rewards-history-title">{t("rewards.redeemedTitle")}</h2>
          <ul>
            {card.redeemed.map((r, i) => (
              <li key={i}>
                {dayLabel(r.day, locale)}
                {r.reward ? ` · ${r.reward}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
