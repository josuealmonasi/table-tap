"use client";

import { useState } from "react";
import { ZONE_GROUPS, offsetLabel } from "@/lib/timezones";
import type { Restaurant } from "@/lib/types";
import type { Role } from "@/lib/membership";
import { useSettings } from "@/hooks/useSettings";
import { BADGES_CHANGED } from "@/hooks/useBadges";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PaymentsCard from "./PaymentsCard";
import CoverCard from "./CoverCard";
import LogoCard from "./LogoCard";

interface SettingsFormProps {
  restaurant: Restaurant;
  role: Role;
  /** Si el plan incluye cobrar en la caja. Falso lo deja visible y apagado. */
  counterPayAllowed?: boolean;
}

// Two-decimal currencies only, so checkout's Math.round(amount * 100) stays
// correct (zero-decimal currencies like JPY would be off by 100x).
const CURRENCIES = ["USD", "MXN"] as const;

/** Dashboard Settings: identity + service charge (owner), tax + pausing (owner + manager). */
export default function SettingsForm({
  restaurant,
  role,
  counterPayAllowed = false,
}: SettingsFormProps) {
  const t = useT();
  const { saving, save } = useSettings();
  const isOwner = role === "owner";

  // Restaurant (owner-only) fields.
  const [name, setName] = useState(restaurant.name);
  const [logo, setLogo] = useState(restaurant.logo ?? "");
  const [tagline, setTagline] = useState(restaurant.tagline ?? "");
  const [currency, setCurrency] = useState(restaurant.currency);
  const [timezone, setTimezone] = useState(restaurant.timezone || "America/Mexico_City");
  const [servicePct, setServicePct] = useState(String(restaurant.service_pct));
  const [serviceEnabled, setServiceEnabled] = useState(restaurant.service_enabled);

  // Tax (owner + manager).
  const [taxPct, setTaxPct] = useState(String(restaurant.tax_pct));
  const [taxBreakdown, setTaxBreakdown] = useState(restaurant.tax_show_breakdown);

  // Ordering (owner + manager) — instant-save.
  const [acceptingOrders, setAcceptingOrders] = useState(restaurant.accepting_orders);
  const [payLater, setPayLater] = useState(Boolean(restaurant.allow_pay_later));
  const [counterPay, setCounterPay] = useState(Boolean(restaurant.allow_counter_payment));
  const [badges, setBadges] = useState(restaurant.badges_enabled !== false);

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

  async function saveTax(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await save({
      tax_pct: Math.min(100, Math.max(0, Number(taxPct) || 0)),
      tax_show_breakdown: taxBreakdown,
    });
  }

  // The kill switch saves immediately — a rushed kitchen shouldn't also have
  // to remember to press "Save".
  async function toggleAcceptingOrders(next: boolean): Promise<void> {
    setAcceptingOrders(next);
    const ok = await save(
      { accepting_orders: next },
      t(next ? "dash.acceptingAgain" : "dash.ordersPaused"),
    );
    if (!ok) setAcceptingOrders(!next); // roll back on failure
  }

  // Off by default and saved immediately, like the kill switch: turning it on
  // lets food leave the kitchen before it is paid for, so it should be a
  // deliberate act with an obvious result.
  // On by default, and turned off for the whole restaurant rather than per
  // person: a count nobody wants is noise for everybody, and the floor does
  // not get to decide it would rather not be told an approval is waiting.
  async function toggleBadges(next: boolean): Promise<void> {
    setBadges(next);
    if (!(await save({ badges_enabled: next }))) {
      setBadges(!next);
      return;
    }
    window.dispatchEvent(new Event(BADGES_CHANGED));
  }

  async function togglePayLater(next: boolean): Promise<void> {
    setPayLater(next);
    if (!(await save({ allow_pay_later: next }))) setPayLater(!next);
  }

  async function toggleCounterPay(next: boolean): Promise<void> {
    setCounterPay(next);
    if (!(await save({ allow_counter_payment: next }))) setCounterPay(!next);
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.settings" },
            ]}
          />
        </header>

        {/* Cards pair up on desktop instead of stacking down one narrow column. */}
        <div className="tt-cols">
          {isOwner && (
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

                <label className="tt-settings-toggle">
                  <span>
                    <strong>{t("dash.serviceFee")}</strong>
                    <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                      {t("dash.serviceFeeHint")}
                    </span>
                  </span>
                  <span
                    className="tt-switch"
                    title={t(serviceEnabled ? "dash.serviceOn" : "dash.serviceOff")}
                  >
                    <input
                      type="checkbox"
                      checked={serviceEnabled}
                      onChange={e => setServiceEnabled(e.target.checked)}
                    />
                    <span className="tt-switch-track" />
                  </span>
                </label>

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
          )}

          {isOwner && <PaymentsCard />}

          {isOwner && <LogoCard restaurant={restaurant} />}

          {isOwner && <CoverCard restaurant={restaurant} />}

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

              <label className="tt-settings-toggle">
                <span>
                  <strong>{t("dash.showBreakdown")}</strong>
                  <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                    {t("dash.showBreakdownHint")}
                  </span>
                </span>
                <span
                  className="tt-switch"
                  title={t(taxBreakdown ? "dash.breakdownShown" : "dash.breakdownHidden")}
                >
                  <input
                    type="checkbox"
                    checked={taxBreakdown}
                    onChange={e => setTaxBreakdown(e.target.checked)}
                  />
                  <span className="tt-switch-track" />
                </span>
              </label>

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

          <div className="tt-section">
            <div className="tt-section-head">
              <h3 className="tt-serif" style={{ margin: 0 }}>
                {t("dash.orderingTitle")}
              </h3>
              <span className="tt-muted" style={{ fontSize: 12 }}>
                {t("dash.orderingHint")}
              </span>
            </div>

            <label className="tt-settings-toggle">
              <span>
                <strong>{t("dash.acceptingOrders")}</strong>
                <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                  {t("dash.acceptingOrdersHint")}
                </span>
              </span>
              <span
                className="tt-switch"
                title={t(acceptingOrders ? "dash.accepting" : "dash.paused")}
              >
                <input
                  type="checkbox"
                  checked={acceptingOrders}
                  disabled={saving}
                  onChange={e => toggleAcceptingOrders(e.target.checked)}
                />
                <span className="tt-switch-track" />
              </span>
            </label>

            <label className="tt-settings-toggle" style={{ marginTop: 10 }}>
              <span>
                <strong>{t("dash.badgesTitle")}</strong>
                <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                  {t("dash.badgesHint")}
                </span>
              </span>
              <span className="tt-switch">
                <input
                  type="checkbox"
                  checked={badges}
                  disabled={saving}
                  onChange={e => toggleBadges(e.target.checked)}
                />
                <span className="tt-switch-track" />
              </span>
            </label>

            {isOwner && (
              <label className="tt-settings-toggle" style={{ marginTop: 10 }}>
                <span>
                  <strong>{t("dash.payLaterTitle")}</strong>
                  <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                    {t("dash.payLaterHint")}
                  </span>
                </span>
                <span className="tt-switch">
                  <input
                    type="checkbox"
                    checked={payLater}
                    disabled={saving}
                    onChange={e => togglePayLater(e.target.checked)}
                  />
                  <span className="tt-switch-track" />
                </span>
              </label>
            )}

            {/* El de arriba es de mesa; éste es del QR general. Van juntos
                porque son la misma pregunta — quién retiene el pedido — con
                dos respuestas distintas según por dónde entró el cliente. */}
            {isOwner && (
              <label className="tt-settings-toggle" style={{ marginTop: 10 }}>
                <span>
                  <strong>{t("dash.counterPayTitle")}</strong>
                  <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                    {counterPayAllowed
                      ? t("dash.counterPayHint")
                      : t("dash.counterPayLocked")}
                  </span>
                </span>
                <span className="tt-switch">
                  <input
                    type="checkbox"
                    checked={counterPay}
                    disabled={saving || !counterPayAllowed}
                    onChange={e => toggleCounterPay(e.target.checked)}
                  />
                  <span className="tt-switch-track" />
                </span>
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
