"use client";

import { useT } from "@/lib/i18n/context";
import { AddIcon, DeleteIcon } from "@/components/ui/icons";
import { STEPS_MAX } from "@/lib/loyalty/ladder";
import { GOAL_MAX, GOAL_MIN, REWARD_MAX } from "@/lib/loyalty/rules";

/** One row as typed: text, so a half-typed number is not thrown away. */
export interface StepDraft {
  id: number;
  visits: string;
  reward: string;
}

interface LadderEditorProps {
  rows: StepDraft[];
  disabled: boolean;
  onChange: (rows: StepDraft[]) => void;
}

/** The next row's visits: four past the last, within the bounds. */
function nextVisits(rows: StepDraft[]): string {
  const last = Math.max(GOAL_MIN - 1, ...rows.map(r => Number(r.visits)).filter(Number.isInteger));
  return String(Math.min(GOAL_MAX, last + 4));
}

/**
 * The rewards a card earns, one row per step: how many visits, and what.
 *
 * Rows stay in the order they were typed while the owner edits; the ladder is
 * sorted by visits when it is saved, so typing 12 above 4 is not a mistake.
 */
export default function LadderEditor({ rows, disabled, onChange }: LadderEditorProps) {
  const t = useT();

  function update(id: number, patch: Partial<StepDraft>): void {
    onChange(rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  function add(): void {
    const id = Math.max(0, ...rows.map(r => r.id)) + 1;
    onChange([...rows, { id, visits: nextVisits(rows), reward: "" }]);
  }

  return (
    <div className="tt-ladder-editor">
      <div className="tt-ladder-head" aria-hidden="true">
        <span>{t("loyaltyAdmin.stepVisits")}</span>
        <span>{t("loyaltyAdmin.rewardLabel")}</span>
      </div>
      {rows.map((row, i) => (
        <div key={row.id} className="tt-ladder-row">
          <input
            className="tt-input"
            type="number"
            inputMode="numeric"
            min={GOAL_MIN}
            max={GOAL_MAX}
            value={row.visits}
            disabled={disabled}
            aria-label={t("loyaltyAdmin.stepVisitsLabel", { n: i + 1 })}
            onChange={e => update(row.id, { visits: e.target.value })}
          />
          <input
            className="tt-input"
            value={row.reward}
            maxLength={REWARD_MAX}
            disabled={disabled}
            placeholder={t("loyaltyAdmin.rewardPlaceholder")}
            aria-label={t("loyaltyAdmin.stepRewardLabel", { n: i + 1 })}
            onChange={e => update(row.id, { reward: e.target.value })}
          />
          {rows.length > 1 ? (
            <button
              type="button"
              className="tt-iconbtn tt-ladder-remove"
              disabled={disabled}
              title={t("loyaltyAdmin.removeStep", { n: i + 1 })}
              aria-label={t("loyaltyAdmin.removeStep", { n: i + 1 })}
              onClick={() => onChange(rows.filter(r => r.id !== row.id))}
            >
              <DeleteIcon size={18} />
            </button>
          ) : (
            <span className="tt-ladder-remove" aria-hidden="true" />
          )}
        </div>
      ))}
      {rows.length < STEPS_MAX && (
        <button type="button" className="tt-btn tt-btn-outline tt-btn-sm tt-ladder-add" disabled={disabled} onClick={add}>
          <AddIcon size={16} weight="bold" />
          {t("loyaltyAdmin.addStep")}
        </button>
      )}
    </div>
  );
}
