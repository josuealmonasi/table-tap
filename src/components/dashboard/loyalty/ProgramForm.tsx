"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { GOAL_MAX, GOAL_MIN, REWARD_MAX } from "@/lib/loyalty/rules";
import type { LoyaltyProgram } from "@/lib/loyalty/server";

interface ProgramFormProps {
  program: LoyaltyProgram;
}

/**
 * Whether the card runs, how many visits earn the reward, and what it is.
 *
 * Saved as one: switching on with no reward written would hand out cards that
 * promise nothing, so the route refuses it and this says why before asking.
 */
export default function ProgramForm({ program }: ProgramFormProps) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [active, setActive] = useState(program.active);
  const [goal, setGoal] = useState(String(program.goal));
  const [reward, setReward] = useState(program.reward);
  const [saving, setSaving] = useState(false);

  const goalNumber = Number(goal);
  const goalOk = Number.isInteger(goalNumber) && goalNumber >= GOAL_MIN && goalNumber <= GOAL_MAX;
  const rewardOk = reward.trim().length <= REWARD_MAX && (!active || reward.trim().length > 0);
  const changed = active !== program.active || goalNumber !== program.goal || reward.trim() !== program.reward;

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/loyalty/program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active, goal: goalNumber, reward: reward.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? t("apiErr.generic"), "error");
        return;
      }
      toast(t("loyaltyAdmin.saved"));
      router.refresh();
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="tt-section">
      <div className="tt-section-head">
        <h2 className="tt-serif" style={{ margin: 0 }}>{t("loyaltyAdmin.programTitle")}</h2>
      </div>
      <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>{t("loyaltyAdmin.programHint")}</p>

      <label className="tt-settings-toggle">
        <span>{t("loyaltyAdmin.activeLabel")}</span>
        <span className="tt-switch">
          <input
            type="checkbox"
            aria-label={t("loyaltyAdmin.activeLabel")}
            checked={active}
            disabled={saving}
            onChange={e => setActive(e.target.checked)}
          />
          <span className="tt-switch-track" />
        </span>
      </label>

      <label className="tt-mod-label tt-loyalty-field" htmlFor="loyalty-goal">{t("loyaltyAdmin.goalLabel")}</label>
      <input
        id="loyalty-goal"
        className="tt-input tt-loyalty-goal"
        type="number"
        inputMode="numeric"
        min={GOAL_MIN}
        max={GOAL_MAX}
        value={goal}
        onChange={e => setGoal(e.target.value)}
      />
      {!goalOk && <p className="tt-field-error">{t("apiErr.loyaltyGoal", { min: GOAL_MIN, max: GOAL_MAX })}</p>}
      <p className="tt-muted" style={{ fontSize: 12 }}>{t("loyaltyAdmin.goalHint")}</p>
      <p className="tt-muted" style={{ fontSize: 12 }}>{t("loyaltyAdmin.roundHint")}</p>

      <label className="tt-mod-label tt-loyalty-field" htmlFor="loyalty-reward">{t("loyaltyAdmin.rewardLabel")}</label>
      <input
        id="loyalty-reward"
        className="tt-input"
        value={reward}
        maxLength={REWARD_MAX}
        placeholder={t("loyaltyAdmin.rewardPlaceholder")}
        onChange={e => setReward(e.target.value)}
      />
      {active && reward.trim().length === 0 && <p className="tt-field-error">{t("apiErr.loyaltyRewardNeeded")}</p>}

      <button
        type="button"
        className="tt-btn tt-btn-primary"
        style={{ marginTop: 16 }}
        disabled={saving || !changed || !goalOk || !rewardOk}
        onClick={() => void save()}
      >
        {saving ? t("loyaltyAdmin.saving") : t("loyaltyAdmin.save")}
      </button>
    </section>
  );
}
