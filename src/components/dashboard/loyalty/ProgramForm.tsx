"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { checkProgram } from "@/lib/loyalty/ladder";
import type { LoyaltyProgram } from "@/lib/loyalty/server";
import LadderEditor, { type StepDraft } from "./LadderEditor";

interface ProgramFormProps {
  program: LoyaltyProgram;
}

/**
 * Whether the card runs, and its rewards: one to four, each earned at a number
 * of visits.
 *
 * Saved as one, and checked here by the same function the route checks it
 * with: switching on with a reward left blank would hand out cards that
 * promise nothing, so the route refuses it and this says why before asking.
 */
export default function ProgramForm({ program }: ProgramFormProps) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [active, setActive] = useState(program.active);
  const [rows, setRows] = useState<StepDraft[]>(() =>
    program.steps.map((s, i) => ({ id: i + 1, visits: String(s.visits), reward: s.reward })),
  );
  const [saving, setSaving] = useState(false);

  const steps = rows.map(r => ({ visits: Number(r.visits), reward: r.reward.trim() }));
  const checked = checkProgram(active, steps);
  const saved = program.steps.map(s => ({ visits: s.visits, reward: s.reward }));
  const changed = active !== program.active || JSON.stringify(steps) !== JSON.stringify(saved);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/loyalty/program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active, steps }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? t("apiErr.generic"), "error");
        return;
      }
      // Saved in order of visits; show it the way it now reads.
      setRows(r => [...r].sort((a, b) => Number(a.visits) - Number(b.visits)));
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

      <p className="tt-mod-label tt-loyalty-field">{t("loyaltyAdmin.stepsLabel")}</p>
      <LadderEditor rows={rows} disabled={saving} onChange={setRows} />
      {"error" in checked && (
        <p className="tt-field-error" role="alert">{t(checked.error, checked.vars)}</p>
      )}
      <p className="tt-muted" style={{ fontSize: 12 }}>{t("loyaltyAdmin.stepsHint")}</p>
      <p className="tt-muted" style={{ fontSize: 12 }}>{t("loyaltyAdmin.goalHint")}</p>
      <p className="tt-muted" style={{ fontSize: 12 }}>{t("loyaltyAdmin.roundHint")}</p>

      <button
        type="button"
        className="tt-btn tt-btn-primary"
        style={{ marginTop: 16 }}
        disabled={saving || !changed || "error" in checked}
        onClick={() => void save()}
      >
        {saving ? t("loyaltyAdmin.saving") : t("loyaltyAdmin.save")}
      </button>
    </section>
  );
}
