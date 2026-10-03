"use client";

import { useState } from "react";
import { ZONE_GROUPS, offsetLabel } from "@/lib/timezones";
import type { Restaurant } from "@/lib/types";
import type { SettingsInput } from "@/hooks/useSettings";
import { useT } from "@/lib/i18n/context";
import SettingsToggle from "./SettingsToggle";

// Two-decimal currencies only, so checkout's Math.round(amount * 100) stays
// correct (zero-decimal currencies like JPY would be off by 100x).
const CURRENCIES = ["USD", "MXN"] as const;

interface RestaurantCardProps {
  restaurant: Restaurant;
  saving: boolean;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}

/** What the diner sees of the place: its name, mark, line, clock, currency and service charge. Owner only. */
export default function RestaurantCard({
  restaurant,
  saving,
  save,
}: RestaurantCardProps) {
  const t = useT();
  const [name, setName] = useState(restaurant.name);
  const [logo, setLogo] = useState(restaurant.logo ?? "");
  const [tagline, setTagline] = useState(restaurant.tagline ?? "");
  const [currency, setCurrency] = useState(restaurant.currency);
  const [timezone, setTimezone] = useState(restaurant.timezone || "America/Mexico_City");
  const [servicePct, setServicePct] = useState(String(restaurant.service_pct));
  const [serviceEnabled, setServiceEnabled] = useState(restaurant.service_enabled);

  async function saveRestaurant(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await save({
      name: name.trim(),
      // Empty means none. This used to substitute the default emoji, so
      // clearing the field appeared to do nothing at all.
      logo: logo.trim() || null,
      tagline: tagline.trim() || null,
      currency,
      timezone,
      service_pct: Math.min(30, Math.max(0, Number(servicePct) || 0)),
      service_enabled: serviceEnabled,
    });
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.restaurant")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.shownToCustomers")}
        </span>
      </div>

      <form className="tt-prodform" onSubmit={saveRestaurant}>
        <div className="tt-prodform-row">
          <input
            className="tt-input"
            style={{ flex: 1 }}
            placeholder={t("dash.restaurantName")}
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
          <input
            className="tt-input"
            style={{ width: 80, textAlign: "center" }}
            placeholder="🍱"
            aria-label={t("dash.logoEmoji")}
            value={logo}
            onChange={e => setLogo(e.target.value)}
          />
        </div>

        <input
          className="tt-input"
          placeholder={t("dash.tagline")}
          value={tagline}
          onChange={e => setTagline(e.target.value)}
        />

        <label className="tt-field" style={{ maxWidth: 260 }}>
          <span className="tt-mod-label">{t("dash.timezone")}</span>
          <select
            className="tt-input"
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
          >
            {ZONE_GROUPS.map(group => (
              <optgroup key={group.labelKey} label={t(group.labelKey)}>
                {group.zones.map(z => (
                  <option key={z.zone} value={z.zone}>
                    {t(z.labelKey)} ({offsetLabel(z.zone)})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="tt-muted" style={{ fontSize: 12 }}>
            {t("dash.timezoneHint")}
          </span>
        </label>

        <label className="tt-field" style={{ maxWidth: 200 }}>
          <span className="tt-mod-label">{t("dash.currency")}</span>
          <select
            className="tt-input"
            value={currency}
            onChange={e => setCurrency(e.target.value)}
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <SettingsToggle
          title={t("dash.serviceFee")}
          hint={t("dash.serviceFeeHint")}
          stateLabel={t(serviceEnabled ? "dash.serviceOn" : "dash.serviceOff")}
          checked={serviceEnabled}
          onChange={setServiceEnabled}
        />

        {serviceEnabled && (
          <label className="tt-field" style={{ width: 150 }}>
            <span className="tt-mod-label">{t("dash.serviceFeePct")}</span>
            <input
              className="tt-input"
              type="number"
              step="0.5"
              min="0"
              max="30"
              value={servicePct}
              onChange={e => setServicePct(e.target.value)}
            />
          </label>
        )}

        <div className="tt-prodform-actions">
          <button
            type="submit"
            className="tt-btn tt-btn-primary tt-btn-sm"
            disabled={!name.trim() || saving}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
