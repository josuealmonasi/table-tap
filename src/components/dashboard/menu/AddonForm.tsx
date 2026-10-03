"use client";

import { useState } from "react";
import type { MenuItem } from "@/lib/types";
import type { AddonInput } from "@/hooks/useMenuEditor";
import { useT } from "@/lib/i18n/context";
import { useDirty } from "@/hooks/useDirty";
import IconPicker from "./IconPicker";

interface AddonFormProps {
  initial?: MenuItem;
  submitLabel: string;
  onSubmit: (input: AddonInput) => Promise<void>;
  onCancel: () => void;
}

/** Small inline form for creating/editing an add-on item. */
export default function AddonForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: AddonFormProps) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(String(initial?.price ?? ""));
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = useDirty([name, price, emoji]);

  return (
    <form
      className="tt-prodform"
      onSubmit={async e => {
        e.preventDefault();
        setSaving(true);
        await onSubmit({ name: name.trim(), price: Number(price) || 0, emoji });
        setSaving(false);
      }}
    >
      <div className="tt-prodform-row">
        <input
          className="tt-input"
          style={{ flex: 1 }}
          placeholder={t("menu.extraNamePlaceholder")}
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
      <IconPicker value={emoji} onChange={setEmoji} variant="addon" />
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
          disabled={!name || !dirty || saving}
        >
          {saving ? "…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
