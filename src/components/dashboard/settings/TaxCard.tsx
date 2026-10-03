"use client";

import { useState } from "react";
import type { Restaurant } from "@/lib/types";
import type { SettingsInput } from "@/hooks/useSettings";
import { useT } from "@/lib/i18n/context";
import SettingsToggle from "./SettingsToggle";

interface TaxCardProps {
  restaurant: Restaurant;
  saving: boolean;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}

/** The tax inside the prices, and whether the diner's total breaks it out. Owner and manager. */
export default function TaxCard({ restaurant, saving, save }: TaxCardProps) {
  const t = useT();
  const [taxPct, setTaxPct] = useState(String(restaurant.tax_pct));
  const [taxBreakdown, setTaxBreakdown] = useState(restaurant.tax_show_breakdown);

  async function saveTax(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await save({
      tax_pct: Math.min(100, Math.max(0, Number(taxPct) || 0)),
      tax_show_breakdown: taxBreakdown,
    });
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.taxTitle")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.taxHint")}
        </span>
      </div>

      <form className="tt-prodform" onSubmit={saveTax}>
        <label className="tt-field" style={{ width: 150 }}>
          <span className="tt-mod-label">{t("dash.ivaPct")}</span>
          <input
            className="tt-input"
            type="number"
            step="0.5"
            min="0"
            max="100"
            value={taxPct}
            onChange={e => setTaxPct(e.target.value)}
          />
        </label>

        <SettingsToggle
          title={t("dash.showBreakdown")}
          hint={t("dash.showBreakdownHint")}
          stateLabel={t(taxBreakdown ? "dash.breakdownShown" : "dash.breakdownHidden")}
          checked={taxBreakdown}
          onChange={setTaxBreakdown}
        />

        <div className="tt-prodform-actions">
          <button
            type="submit"
            className="tt-btn tt-btn-primary tt-btn-sm"
            disabled={saving}
          >
            {saving ? t("common.saving") : t("dash.saveTax")}
          </button>
        </div>
      </form>
    </div>
  );
}
