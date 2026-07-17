"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem, Modifier } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import { DIETARY_TAGS } from "@/lib/dietary";
import IconPicker from "./IconPicker";
import ModifiersEditor from "./ModifiersEditor";

interface ProductFormProps {
  /** The product being edited; omit to add a new one. */
  initial?: Partial<MenuItem>;
  addons: MenuItem[];
  selectedAddonIds?: string[];
  currency: string;
  submitLabel: string;
  onSubmit: (input: ProductInput, addonIds: string[]) => Promise<void> | void;
  onCancel: () => void;
}

/** Add/edit form for a product, including which add-on items it offers. */
export default function ProductForm({
  initial,
  addons,
  selectedAddonIds = [],
  currency,
  submitLabel,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(String(initial?.price ?? ""));
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [popular, setPopular] = useState(initial?.popular ?? false);
  const [modifiers, setModifiers] = useState<Modifier[]>(initial?.modifiers ?? []);
  const [dietary, setDietary] = useState<string[]>(initial?.dietary ?? []);
  const [picked, setPicked] = useState<string[]>(selectedAddonIds);
  const [saving, setSaving] = useState(false);

  function toggleAddon(id: string) {
    setPicked(prev => (prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]));
  }

  function toggleDietary(key: string) {
    setDietary(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSubmit(
      {
        name: name.trim(),
        description: description.trim(),
        price: Number(price) || 0,
        image_url: imageUrl.trim() || null,
        emoji,
        popular,
        // Only keep groups that actually have a name and choices.
        modifiers: modifiers
          .map(g => ({
            label: g.label.trim(),
            type: g.type,
            options: g.options.map(o => o.trim()).filter(Boolean),
          }))
          .filter(g => g.label && g.options.length > 0),
        dietary,
      },
      picked,
    );
    setSaving(false);
  }

  return (
    <form className="tt-prodform" onSubmit={handleSubmit}>
      <div className="tt-prodform-row">
        <input
          className="tt-input"
          style={{ flex: 1 }}
          placeholder="Product name (e.g. Hot Dog)"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus={!initial}
          required
        />
        <input
          className="tt-input"
          style={{ width: 110 }}
          type="number"
          step="0.01"
          min="0"
          placeholder="Price"
          value={price}
          onChange={e => setPrice(e.target.value)}
          required
        />
      </div>

      <textarea
        className="tt-input"
        rows={2}
        placeholder="Description (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
      />

      <input
        className="tt-input"
        placeholder="Image URL (optional — upload coming soon)"
        value={imageUrl}
        onChange={e => setImageUrl(e.target.value)}
      />

      <label className="tt-check">
        <input
          type="checkbox"
          checked={popular}
          onChange={e => setPopular(e.target.checked)}
        />
        Mark as popular
      </label>

      <IconPicker value={emoji} onChange={setEmoji} />

      <ModifiersEditor value={modifiers} onChange={setModifiers} />

      <div>
        <div className="tt-mod-label" style={{ marginTop: 6 }}>
          Dietary &amp; allergens{" "}
          <span className="tt-muted" style={{ fontWeight: 400 }}>
            (shown to customers)
          </span>
        </div>
        <div className="tt-chips">
          {DIETARY_TAGS.map(tag => (
            <button
              type="button"
              key={tag.key}
              className={`tt-chip ${dietary.includes(tag.key) ? "tt-chip-on" : ""}`}
              onClick={() => toggleDietary(tag.key)}
            >
              {tag.emoji} {tag.label}
            </button>
          ))}
        </div>
      </div>

      {addons.length > 0 && (
        <div>
          <div className="tt-mod-label" style={{ marginTop: 6 }}>
            Extras offered
          </div>
          <div className="tt-chips">
            {addons.map(a => (
              <button
                type="button"
                key={a.id}
                className={`tt-chip ${picked.includes(a.id) ? "tt-chip-on" : ""}`}
                onClick={() => toggleAddon(a.id)}
              >
                {a.emoji ? `${a.emoji} ` : ""}
                {a.name} · {formatMoney(a.price, currency)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tt-prodform-actions">
        <button
          type="button"
          className="tt-btn tt-btn-ghost tt-btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={!name || saving}
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
