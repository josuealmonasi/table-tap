"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useDirty } from "@/hooks/useDirty";
import { isEmoji } from "@/lib/icon-groups";
import { isBuiltIn, tagKey, type StoredDietaryTag } from "@/lib/dietary";

/** Rótulo, su emoji, y el inglés si el restaurante quiere ponerlo. */
export default function DietaryTagForm({
  initial,
  busy,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: StoredDietaryTag;
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: { label: string; labelEn: string | null; emoji: string }) => Promise<void>;
}) {
  const t = useT();
  const builtIn = initial ? isBuiltIn(initial.key) : false;
  const [label, setLabel] = useState(initial?.label ?? "");
  const [labelEn, setLabelEn] = useState(initial?.label_en ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🏷️");
  const dirty = useDirty([label, labelEn, emoji]);

  // Una etiqueta que no deja `key` utilizable —sólo emoji, o sólo signos— no
  // tiene dónde guardarse dentro del platillo.
  const usable = Boolean(tagKey(label));

  return (
    <form
      className="tt-prodform"
      onSubmit={async e => {
        e.preventDefault();
        if (!usable) return;
        await onSubmit({
          label: label.trim(),
          labelEn: labelEn.trim() || null,
          emoji: isEmoji(emoji) ? emoji.trim() : "🏷️",
        });
      }}
    >
      <div className="tt-row" style={{ gap: 8, alignItems: "flex-start" }}>
        <input
          className="tt-input"
          style={{ width: 74, textAlign: "center", flex: "0 0 auto" }}
          aria-label={t("menu.dietaryEmoji")}
          value={emoji}
          onChange={e => setEmoji(e.target.value)}
        />
        <input
          className="tt-input"
          style={{ flex: 1, minWidth: 0 }}
          placeholder={t("menu.dietaryName")}
          aria-label={t("menu.dietaryName")}
          value={label}
          onChange={e => setLabel(e.target.value)}
          required
        />
      </div>

      {/* Las de casa ya se traducen solas; ofrecer el campo sólo confundiría. */}
      {!builtIn && (
        <label className="tt-field">
          <span className="tt-mod-label">{t("menu.dietaryNameEn")}</span>
          <input
            className="tt-input"
            placeholder={t("menu.dietaryNameEnHint")}
            value={labelEn}
            onChange={e => setLabelEn(e.target.value)}
          />
        </label>
      )}

      {builtIn && (
        <p className="tt-muted" style={{ fontSize: 12, margin: 0 }}>
          {t("menu.dietaryBuiltInHint")}
        </p>
      )}

      <div className="tt-row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onCancel}>
          {t("menu.cancel")}
        </button>
        <button
          type="submit"
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={busy || !usable || (Boolean(initial) && !dirty)}
        >
          {busy ? "…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
