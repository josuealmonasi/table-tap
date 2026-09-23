"use client";

import { useT } from "@/lib/i18n/context";
import { nextStep } from "@/lib/loyalty/next-step";
import type { Standing } from "@/lib/loyalty/standing";
import LadderSteps from "@/components/loyalty/LadderSteps";

/** What the stamp or redeem route answered, and which of the two it was. */
export interface Outcome {
  kind: "stamp" | "redeem";
  code: string;
  /** Its rewards included: the next one is `standing.next`. */
  standing: Standing;
  /** Stamp: false when the card already had today's visit. */
  stamped?: boolean;
  /** Redeem: the reward as it read when it was spent. */
  spent?: string;
}

interface StampOutcomeProps {
  outcome: Outcome;
  busy: boolean;
  error: string | null;
  onRedeem: () => void;
  onAnother: () => void;
}

/** The card after the scan: what just happened, where it stands, what is next. */
export default function StampOutcome({ outcome, busy, error, onRedeem, onAnother }: StampOutcomeProps) {
  const t = useT();
  const { standing: s } = outcome;
  const reward = s.next?.reward ?? "";

  const headline =
    outcome.kind === "redeem"
      ? outcome.spent
        ? t("loyalty.redeemed", { reward: outcome.spent })
        : t("loyalty.redeemedNoReward")
      : outcome.stamped
        ? t("loyalty.stamped")
        : t("loyalty.already");
  const next = nextStep(s);

  return (
    <div className="tt-stamp-outcome">
      <p className="tt-stamp-headline">{headline}</p>
      <p className="tt-rewards-count">{t("rewards.visitsOf", { visits: s.visits, goal: s.goal })}</p>
      <LadderSteps standing={s} />
      {s.ready ? (
        <>
          <p className="tt-rewards-ready">{t("loyalty.ready")}</p>
          <button type="button" className="tt-btn tt-btn-primary" disabled={busy} onClick={onRedeem}>
            {busy
              ? t("loyalty.redeeming")
              : reward
                ? t("loyalty.redeem", { reward })
                : t("loyalty.redeemNoReward")}
          </button>
        </>
      ) : (
        <p className="tt-rewards-next">{t(next.key, next.vars)}</p>
      )}
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <button type="button" className="tt-btn tt-btn-ghost" onClick={onAnother} disabled={busy}>
        {t("loyalty.another")}
      </button>
    </div>
  );
}
