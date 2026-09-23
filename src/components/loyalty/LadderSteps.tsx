"use client";

import { useT } from "@/lib/i18n/context";
import type { Standing } from "@/lib/loyalty/standing";

interface LadderStepsProps {
  standing: Standing;
}

/**
 * Every reward on a card and where each one stands: redeemed this round, ready
 * now, or how many visits away. The diner, the waiter and the manager read the
 * same list, so none of them is told a different ladder.
 *
 * A card with one reward has nothing to list — the sentence under the count
 * already says it — so this draws nothing, and those cards look as they did.
 */
export default function LadderSteps({ standing: s }: LadderStepsProps) {
  const t = useT();
  if (s.steps.length < 2) return null;
  return (
    <ul className="tt-ladder" aria-label={t("ladder.title")}>
      {s.steps.map(step => {
        const state = step.done ? "done" : step.reached ? "ready" : "ahead";
        return (
          <li key={step.visits} className={`tt-ladder-step tt-ladder-${state}`}>
            <span className="tt-ladder-visits">{t("ladder.visits", { n: step.visits })}</span>
            <span className="tt-ladder-reward">{step.reward || t("ladder.noReward")}</span>
            <span className="tt-ladder-state">
              {state === "done"
                ? t("ladder.done")
                : state === "ready"
                  ? t("ladder.ready")
                  : t("ladder.toGo", { n: step.visits - s.visits })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
