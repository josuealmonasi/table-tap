"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem, Modifier } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import { DIETARY_TAGS } from "@/lib/dietary";
import { useT } from "@/lib/i18n/context";
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
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(String(initial?.price ?? ""));
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [popular, setPopular] = useState(initial?.popular ?? false);
  const [modifiers, setModifiers] = useState<Modifier[]>(initial?.modifiers ?? []);
  const [dietary, setDietary] = useState<string[]>(initial?.dietary ?? []);
  const [discountPct, setDiscountPct] = useState(String(initial?.discount_pct ?? ""));
  const [picked, setPicked] = useState<string[]>(selectedAddonIds);
  const [saving, setSaving] = useState(false);

  // Clamp to the same 0–99 range the DB constraint enforces.
  const pct = Math.min(99, Math.max(0, Number(discountPct) || 0));
  const basePrice = Number(price) || 0;
  const salePrice = Math.round(basePrice * (1 - pct / 100) * 100) / 100;

  function toggleAddon(id: string) {
    setPicked(prev => (prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]));
  }

  function toggleDietary(key: string) {
    setDietary(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
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
        // Only keep groups that actually have a name and choices. Every field
        // the group carries has to be listed here — this rebuilds the object
        // rather than spreading it, so anything omitted is silently dropped on
        // save. `required` was, which meant a manager could tick the box, save,
        // and the customer would still be able to add without choosing.
        modifiers: modifiers
          .map(g => ({
            label: g.label.trim(),
            type: g.type,
            options: g.options.map(o => o.trim()).filter(Boolean),
            // Written only when true, so groups that don't need it stay clean
            // in the stored JSON.
            ...(g.required ? { required: true } : {}),
          }))
          .filter(g => g.label && g.options.length > 0),
        dietary,
        discount_pct: pct,
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
          placeholder={t("menu.productNamePlaceholder")}
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
          placeholder={t("menu.pricePlaceholder")}
          value={price}
          onChange={e => setPrice(e.target.value)}
          required
        />
      </div>

      <div className="tt-prodform-row">
        <input
          className="tt-input"
          style={{ width: 110 }}
          type="number"
          step="1"
          min="0"
          max="99"
          placeholder={t("menu.discountPlaceholder")}
          value={discountPct}
          onChange={e => setDiscountPct(e.target.value)}
        />
        <span className="tt-muted" style={{ fontSize: 13 }}>
          {pct > 0 ? (
            <>
              <s>{formatMoney(basePrice, currency)}</s>{" "}
              <strong className="tt-accent">{formatMoney(salePrice, currency)}</strong>{" "}
              {t("menu.discountShownToCustomers")}
            </>
          ) : (
            t("menu.discountHint")
          )}
        </span>
      </div>

      <textarea
        className="tt-input"
        rows={2}
        placeholder={t("menu.descriptionPlaceholder")}
        value={description}
        onChange={e => setDescription(e.target.value)}
      />

      <input
        className="tt-input"
        placeholder={t("menu.imageUrlPlaceholder")}
        value={imageUrl}
        onChange={e => setImageUrl(e.target.value)}
      />

      <label className="tt-check">
        <input
          type="checkbox"
          checked={popular}
          onChange={e => setPopular(e.target.checked)}
        />
        {t("menu.markPopular")}
      </label>

      <IconPicker value={emoji} onChange={setEmoji} />

      <ModifiersEditor value={modifiers} onChange={setModifiers} />

      <div>
        <div className="tt-mod-label" style={{ marginTop: 6 }}>
          {t("menu.dietaryAllergens")}{" "}
          <span className="tt-muted" style={{ fontWeight: 400 }}>
            {t("menu.shownToCustomers")}
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
              {tag.emoji} {t(`dietary.${tag.key}`)}
            </button>
          ))}
        </div>
      </div>

      {addons.length > 0 && (
        <div>
          <div className="tt-mod-label" style={{ marginTop: 6 }}>
            {t("menu.extrasOffered")}
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
          {t("menu.cancel")}
        </button>
        <button
          type="submit"
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={!name || saving}
        >
          {saving ? t("common.saving") : submitLabel}
        </button>
      </div>
    </form>
  );
}
