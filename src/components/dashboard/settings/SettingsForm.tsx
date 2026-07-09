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
const CURRENCIES = ["USD", "EUR", "GBP", "MXN", "CAD", "AUD"] as const;

/** Dashboard Settings: edit the restaurant's identity and service charge. */
export default function SettingsForm({ restaurant }: SettingsFormProps) {
  const { saving, save } = useSettings(restaurant.id);
  const [name, setName] = useState(restaurant.name);
  const [logo, setLogo] = useState(restaurant.logo);
  const [tagline, setTagline] = useState(restaurant.tagline ?? "");
  const [currency, setCurrency] = useState(restaurant.currency);
  const [servicePct, setServicePct] = useState(String(restaurant.service_pct));
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
      accepting_orders: acceptingOrders,
    });
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]} />
        </header>

        <div className="tt-section" style={{ maxWidth: 520 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>Restaurant</h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>Shown to customers on your menu</span>
          </div>

          <form className="tt-prodform" onSubmit={handleSubmit}>
            <div className="tt-prodform-row">
              <input
                className="tt-input"
                style={{ flex: 1 }}
                placeholder="Restaurant name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <input
                className="tt-input"
                style={{ width: 80, textAlign: "center" }}
                placeholder="🍱"
                aria-label="Logo emoji"
                value={logo}
                onChange={(e) => setLogo(e.target.value)}
              />
            </div>

            <input
              className="tt-input"
              placeholder="Tagline (optional)"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
            />

            <div className="tt-prodform-row">
              <label className="tt-field" style={{ flex: 1 }}>
                <span className="tt-mod-label">Currency</span>
                <select className="tt-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="tt-field" style={{ width: 150 }}>
                <span className="tt-mod-label">Service charge %</span>
                <input
                  className="tt-input"
                  type="number"
                  step="0.5"
                  min="0"
                  max="30"
                  value={servicePct}
                  onChange={(e) => setServicePct(e.target.value)}
                />
              </label>
            </div>

            <label className="tt-settings-toggle">
              <span>
                <strong>Accepting orders</strong>
                <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
                  Turn off to pause new customer orders (e.g. kitchen closed or slammed)
                </span>
              </span>
              <span className="tt-switch" title={acceptingOrders ? "Accepting orders" : "Orders paused"}>
                <input
                  type="checkbox"
                  checked={acceptingOrders}
                  onChange={(e) => setAcceptingOrders(e.target.checked)}
                />
                <span className="tt-switch-track" />
              </span>
            </label>

            <div className="tt-prodform-actions">
              <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={!name.trim() || saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
