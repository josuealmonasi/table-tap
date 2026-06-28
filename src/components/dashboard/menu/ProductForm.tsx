"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import IconPicker from "./IconPicker";

/** Add/edit form for a product, including which add-on items it offers. */
export default function ProductForm({
  initial,
  addons,
  selectedAddonIds = [],
  currency,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<MenuItem>;
  addons: MenuItem[];
  selectedAddonIds?: string[];
  currency: string;
  submitLabel: string;
  onSubmit: (input: ProductInput, addonIds: string[]) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(String(initial?.price ?? ""));
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [popular, setPopular] = useState(initial?.popular ?? false);
  const [picked, setPicked] = useState<string[]>(selectedAddonIds);
  const [saving, setSaving] = useState(false);

  function toggleAddon(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSubmit(
      {
        name: name.trim(),
        description: description.trim(),
        price: Number(price) || 0,
        emoji,
        image_url: imageUrl.trim() || null,
        popular,
      },
      picked
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
          onChange={(e) => setName(e.target.value)}
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
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </div>

      <IconPicker value={emoji} onChange={setEmoji} />

      <textarea
        className="tt-input"
        rows={2}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <input
        className="tt-input"
        placeholder="Image URL (optional — upload coming soon)"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
      />

      <label className="tt-check">
        <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} />
        Mark as popular
      </label>

      {addons.length > 0 && (
        <div>
          <div className="tt-mod-label" style={{ marginTop: 6 }}>Add-ons offered</div>
          <div className="tt-chips">
            {addons.map((a) => (
              <button
                type="button"
                key={a.id}
                className={`tt-chip ${picked.includes(a.id) ? "tt-chip-on" : ""}`}
                onClick={() => toggleAddon(a.id)}
              >
                {a.emoji} {a.name} · {formatMoney(a.price, currency)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tt-prodform-actions">
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={!name || saving}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
