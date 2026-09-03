"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import type { SettingsInput } from "@/hooks/useSettings";

/**
 * When to be told a dish is running out.
 *
 * Its own card rather than another block in the settings form, which is long
 * enough already. The switch saves the moment it is flipped — the same reason
 * the kill switch does — while the number waits for the field to be left, so
 * that typing "10" does not save a 1 on the way.
 */
export default function InventoryCard({
  alertsEnabled,
  threshold,
  saving,
  save,
}: {
  alertsEnabled: boolean;
  threshold: number;
  saving: boolean;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(alertsEnabled);
  const [limit, setLimit] = useState(String(threshold));

  async function toggle(next: boolean): Promise<void> {
    setEnabled(next);
    // Put the switch back if the write did not land, rather than leaving it
    // showing a setting the restaurant does not actually have.
    if (!(await save({ low_stock_alerts_enabled: next }))) setEnabled(!next);
  }

  async function commitLimit(): Promise<void> {
    const next = Math.min(999, Math.max(0, Math.floor(Number(limit) || 0)));
    setLimit(String(next));
    if (next === threshold) return;
    if (!(await save({ low_stock_threshold: next }))) setLimit(String(threshold));
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.stockAlertsTitle")}
        </h3>
      </div>

      <label className="tt-settings-toggle">
        {/* The name is the section heading directly above; repeating it here
            would have the screen say the same thing twice in a row. */}
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.stockAlertsHint")}
        </span>
        <span className="tt-switch">
          <input
            type="checkbox"
            aria-label={t("dash.stockAlertsTitle")}
            checked={enabled}
            disabled={saving}
            onChange={e => toggle(e.target.checked)}
          />
          <span className="tt-switch-track" />
        </span>
      </label>

      {/* Only once the alerts are on: a threshold that warns nobody is a
          question the screen has no reason to ask. */}
      {enabled && (
        <div style={{ marginTop: 12 }}>
          <label className="tt-field" style={{ maxWidth: 260 }}>
            <span className="tt-mod-label">{t("dash.stockThreshold")}</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              aria-label={t("dash.stockThreshold")}
              className="tt-input"
              type="number"
              min={0}
              max={999}
              inputMode="numeric"
              style={{ maxWidth: 110 }}
              value={limit}
              disabled={saving}
              onChange={e => setLimit(e.target.value)}
              onBlur={commitLimit}
            />
            <span className="tt-muted" style={{ fontSize: 13 }}>
              {t("dash.stockUnits")}
            </span>
          </div>
          <p className="tt-muted" style={{ fontSize: 12, marginTop: 6 }}>
            {t("dash.stockThresholdHint")}
          </p>
        </div>
      )}
    </div>
  );
}
