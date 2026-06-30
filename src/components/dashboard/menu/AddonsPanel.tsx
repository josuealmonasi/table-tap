"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
import type { AddonInput } from "@/hooks/useMenuEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import ReorderButtons from "@/components/ui/ReorderButtons";
import IconPicker from "./IconPicker";

/** Manages the restaurant's reusable add-on items (e.g. Catsup, Extra cheese). */
export default function AddonsPanel({
  addons,
  currency,
  onAdd,
  onUpdate,
  onDelete,
  onToggleAvailable,
  onMove,
  modalForms = true,
}: {
  addons: MenuItem[];
  currency: string;
  onAdd: (input: AddonInput) => Promise<void>;
  onUpdate: (id: string, input: AddonInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleAvailable: (id: string, available: boolean) => void;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
  /** Open add/edit forms in a focused modal instead of expanding inline. Defaults to on. */
  modalForms?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>🧂 Extras</h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>Attach these to products</span>
      </div>

      {addons.length === 0 && (
        <p className="tt-muted" style={{ fontSize: 13 }}>
          No extras yet. Create one (e.g. Catsup) to offer it on products.
        </p>
      )}

      {addons.map((addon, i) => {
        const isEditing = editingId === addon.id;
        const editForm = (
          <AddonForm
            initial={addon}
            submitLabel="Save"
            onCancel={() => setEditingId(null)}
            onSubmit={async (input) => {
              await onUpdate(addon.id, input);
              setEditingId(null);
            }}
          />
        );

        if (!modalForms && isEditing) {
          return <div key={addon.id} className="tt-prod-editing">{editForm}</div>;
        }

        return (
          <div key={addon.id}>
            <div className={`tt-prod ${addon.available ? "" : "tt-prod-off"}`}>
              <ReorderButtons
                canMoveUp={i > 0}
                canMoveDown={i < addons.length - 1}
                onMoveUp={() => onMove(addon.id, "up")}
                onMoveDown={() => onMove(addon.id, "down")}
              />
              <div className="tt-prod-thumb"><span>{addon.emoji || addon.name.charAt(0).toUpperCase()}</span></div>
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
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Delete extra “${addon.name}”?`,
                          confirmLabel: "Delete",
                          danger: true,
                        })
                      ) {
                        onDelete(addon.id);
                      }
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
            {modalForms && (
              <Modal open={isEditing} onClose={() => setEditingId(null)} maxWidth={520}>
                {editForm}
              </Modal>
            )}
          </div>
        );
      })}

      {(() => {
        const addForm = (
          <AddonForm
            submitLabel="Add extra"
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              await onAdd(input);
              setAdding(false);
            }}
          />
        );

        if (modalForms) {
          return (
            <>
              <button className="tt-add-more" onClick={() => setAdding(true)}>+ Add extra</button>
              <Modal open={adding} onClose={() => setAdding(false)} maxWidth={520}>
                {addForm}
              </Modal>
            </>
          );
        }

        return adding ? (
          <div className="tt-prod-editing">{addForm}</div>
        ) : (
          <button className="tt-add-more" onClick={() => setAdding(true)}>+ Add extra</button>
        );
      })()}
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
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="tt-prodform"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSubmit({ name: name.trim(), price: Number(price) || 0, emoji });
        setSaving(false);
      }}
    >
      <div className="tt-prodform-row">
        <input className="tt-input" style={{ flex: 1 }} placeholder="Extra name (e.g. Catsup)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="tt-input" style={{ width: 110 }} type="number" step="0.01" min="0" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} required />
      </div>
      <IconPicker value={emoji} onChange={setEmoji} variant="addon" />
      <div className="tt-prodform-actions">
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={!name || saving}>{saving ? "…" : submitLabel}</button>
      </div>
    </form>
  );
}
