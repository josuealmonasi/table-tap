"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useDirty } from "@/hooks/useDirty";
import { isEmoji, type IconVariant, type StoredIconGroup } from "@/lib/icon-groups";

/** Name, which palette it is for, and the emoji — separated by spaces. */
export default function IconGroupForm({
  initial,
  busy,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: StoredIconGroup;
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    variant: IconVariant;
    icons: { emoji: string }[];
  }) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [variant, setVariant] = useState<IconVariant>(initial?.variant ?? "addon");
  const [icons, setIcons] = useState((initial?.items ?? []).map(i => i.emoji).join(" "));
  const dirty = useDirty([name, variant, icons]);

  // They are typed space-separated and only the real emoji are kept: it is
  // faster than a grid and does not force us to maintain a catalogue.
  const chosen = icons.split(/\s+/).filter(isEmoji);

  return (
    <form
      className="tt-prodform"
      onSubmit={async e => {
        e.preventDefault();
        if (!name.trim() || chosen.length === 0) return;
        await onSubmit({
          name: name.trim(),
          variant,
          icons: chosen.map(emoji => ({ emoji })),
        });
      }}
    >
      <input
        className="tt-input"
        placeholder={t("menu.iconGroupName")}
        aria-label={t("menu.iconGroupName")}
        value={name}
        onChange={e => setName(e.target.value)}
        required
      />

      <label className="tt-field">
        <span className="tt-mod-label">{t("menu.iconGroupFor")}</span>
        <select
          className="tt-input"
          value={variant}
          onChange={e => setVariant(e.target.value as IconVariant)}
        >
          <option value="addon">{t("menu.forExtras")}</option>
          <option value="product">{t("menu.forProducts")}</option>
        </select>
      </label>

      <label className="tt-field">
        <span className="tt-mod-label">{t("menu.iconGroupIcons")}</span>
        <input
          className="tt-input"
          placeholder="🌮 🌶️ 🧄"
          aria-label={t("menu.iconGroupIcons")}
          value={icons}
          onChange={e => setIcons(e.target.value)}
        />
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {chosen.length > 0
            ? t("menu.iconGroupCount", { n: chosen.length })
            : t("menu.iconGroupIconsHint")}
        </span>
      </label>

      <div className="tt-row" style={{ justifyContent: "flex-end", gap: 8 }}>
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
          disabled={
            busy || !name.trim() || chosen.length === 0 || (Boolean(initial) && !dirty)
          }
        >
          {busy ? "…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
