"use client";

import { useState } from "react";
import type { Restaurant } from "@/lib/types";
import { useSettings } from "@/hooks/useSettings";
import Breadcrumb from "@/components/layout/Breadcrumb";

interface SettingsFormProps {
  restaurant: Restaurant;
}

// Two-decimal currencies only, so checkout's Math.round(amount * 100) stays
// correct (zero-decimal currencies like JPY would be off by 100x).
const CURRENCIES = ["USD", "MXN"] as const;

/** Dashboard Settings: restaurant identity, service charge, and order pausing. */
export default function SettingsForm({ restaurant }: SettingsFormProps) {
  const { saving, save } = useSettings(restaurant.id);
  const [name, setName] = useState(restaurant.name);
  const [logo, setLogo] = useState(restaurant.logo);
  const [tagline, setTagline] = useState(restaurant.tagline ?? "");
  const [currency, setCurrency] = useState(restaurant.currency);
  const [servicePct, setServicePct] = useState(String(restaurant.service_pct));
  const [serviceEnabled, setServiceEnabled] = useState(restaurant.service_enabled);
  const [acceptingOrders, setAcceptingOrders] = useState(restaurant.accepting_orders);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const pct = Math.min(30, Math.max(0, Number(servicePct) || 0));
    await save({
      name: name.trim(),
      logo: logo.trim() || "🍱",
      tagline: tagline.trim() || null,
      currency,
      service_pct: pct,
      service_enabled: serviceEnabled,
    });
  }

  // The kill switch saves immediately — a rushed kitchen shouldn't also have
  // to remember to press "Save changes".
  async function toggleAcceptingOrders(next: boolean): Promise<void> {
    setAcceptingOrders(next);
    const ok = await save(
      { accepting_orders: next },
      next ? "Accepting orders again" : "Orders paused",
    );
    if (!ok) setAcceptingOrders(!next); // roll back on failure
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]}
          />
        </header>

        <div className="tt-section" style={{ maxWidth: 520 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              Restaurant
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              Shown to customers on your menu
            </span>
          </div>

          <form className="tt-prodform" onSubmit={handleSubmit}>
            <div className="tt-prodform-row">
              <input
                className="tt-input"
                style={{ flex: 1 }}
                placeholder="Restaurant name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
              <input
                className="tt-input"
                style={{ width: 80, textAlign: "center" }}
                placeholder="🍱"
                aria-label="Logo emoji"
                value={logo}
                onChange={e => setLogo(e.target.value)}
              />
            </div>

            <input
              className="tt-input"
              placeholder="Tagline (optional)"
              value={tagline}
              onChange={e => setTagline(e.target.value)}
            />

            <label className="tt-field" style={{ maxWidth: 200 }}>
              <span className="tt-mod-label">Currency</span>
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
                <strong>Charge a service fee</strong>
                <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                  Added to every order as a % of the subtotal — off by default
                </span>
              </span>
              <span
                className="tt-switch"
                title={serviceEnabled ? "Service fee on" : "Service fee off"}
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
                <span className="tt-mod-label">Service fee %</span>
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
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>

        <div className="tt-section" style={{ maxWidth: 520, marginTop: 16 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              Ordering
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              Applies immediately — no save needed
            </span>
          </div>

          <label className="tt-settings-toggle">
            <span>
              <strong>Accepting orders</strong>
              <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                Turn off to pause new customer orders (e.g. kitchen closed or slammed)
              </span>
            </span>
            <span
              className="tt-switch"
              title={acceptingOrders ? "Accepting orders" : "Orders paused"}
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
        </div>
      </div>
    </div>
  );
}
