"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
import type { AddonInput } from "@/hooks/useMenuEditor";

/** Manages the restaurant's reusable add-on items (e.g. Catsup, Extra cheese). */
export default function AddonsPanel({
  addons,
  currency,
  onAdd,
  onUpdate,
  onDelete,
  onToggleAvailable,
}: {
  addons: MenuItem[];
  currency: string;
  onAdd: (input: AddonInput) => Promise<void>;
  onUpdate: (id: string, input: AddonInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleAvailable: (id: string, available: boolean) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>🧂 Add-on items</h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>Attach these to products</span>
      </div>

      {addons.length === 0 && (
        <p className="tt-muted" style={{ fontSize: 13 }}>
          No add-ons yet. Create one (e.g. Catsup) to offer it on products.
        </p>
      )}

      {addons.map((addon) =>
        editingId === addon.id ? (
          <AddonForm
            key={addon.id}
            initial={addon}
            submitLabel="Save"
            onCancel={() => setEditingId(null)}
            onSubmit={async (input) => {
              await onUpdate(addon.id, input);
              setEditingId(null);
            }}
          />
        ) : (
          <div key={addon.id} className={`tt-prod ${addon.available ? "" : "tt-prod-off"}`}>
            <div className="tt-prod-thumb"><span>{addon.emoji}</span></div>
            <div style={{ flex: 1 }}>
              <strong>{addon.name}</strong>
              {!addon.available && <span className="tt-badge" style={{ marginLeft: 6 }}>Unavailable</span>}
            </div>
            <div className="tt-prod-right">
              <strong className="tt-accent">{formatMoney(addon.price, currency)}</strong>
              <label className="tt-switch" title={addon.available ? "Available" : "Unavailable"}>
                <input
                  type="checkbox"
                  checked={addon.available}
                  onChange={(e) => onToggleAvailable(addon.id, e.target.checked)}
                />
                <span className="tt-switch-track" />
              </label>
              <div className="tt-prod-actions">
                <button className="tt-iconbtn" title="Edit" onClick={() => setEditingId(addon.id)}>✏️</button>
                <button
                  className="tt-iconbtn"
                  title="Delete"
                  onClick={() => {
                    if (confirm(`Delete add-on "${addon.name}"?`)) onDelete(addon.id);
                  }}
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {adding ? (
        <AddonForm
          submitLabel="Add add-on"
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await onAdd(input);
            setAdding(false);
          }}
        />
      ) : (
        <button className="tt-add-more" onClick={() => setAdding(true)}>+ Add add-on item</button>
      )}
    </div>
  );
}

/** Small inline form for creating/editing an add-on item. */
function AddonForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: MenuItem;
  submitLabel: string;
  onSubmit: (input: AddonInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(String(initial?.price ?? ""));
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🧂");
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="tt-prod tt-prod-editing"
      style={{ gap: 8 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSubmit({ name: name.trim(), price: Number(price) || 0, emoji: emoji || "🧂" });
        setSaving(false);
      }}
    >
      <input className="tt-input" style={{ width: 56, textAlign: "center" }} value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" />
      <input className="tt-input" style={{ flex: 1 }} placeholder="Add-on name (e.g. Catsup)" value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="tt-input" style={{ width: 100 }} type="number" step="0.01" min="0" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} required />
      <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onCancel}>Cancel</button>
      <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={!name || saving}>{saving ? "…" : submitLabel}</button>
    </form>
  );
}
