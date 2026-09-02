"use client";

import { useState } from "react";
import type { Modifier } from "@/lib/types";
import { reindexAfterRemoval } from "@/lib/reindex";
import { useT } from "@/lib/i18n/context";
import { CloseIcon, DeleteIcon } from "@/components/ui/icons";

interface ModifiersEditorProps {
  value: Modifier[];
  onChange: (modifiers: Modifier[]) => void;
}

/**
 * Edits a product's option groups (e.g. "Spice level" → Mild/Medium/Hot).
 * "One choice" renders as radio-style pills for the customer; "any" as
 * multi-select. Stored as the modifiers JSON on the product.
 */
export default function ModifiersEditor({ value, onChange }: ModifiersEditorProps) {
  const t = useT();
  // One draft option text per group, keyed by index.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  function patchGroup(i: number, patch: Partial<Modifier>): void {
    onChange(value.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }

  function addOption(i: number): void {
    const text = (drafts[i] ?? "").trim();
    if (!text || value[i].options.includes(text)) return;
    patchGroup(i, { options: [...value[i].options, text] });
    setDrafts(prev => ({ ...prev, [i]: "" }));
  }

  return (
    <div>
      <div className="tt-mod-label" style={{ marginTop: 6 }}>
        {t("menu.optionGroups")}{" "}
        <span className="tt-muted" style={{ fontWeight: 400 }}>
          {t("menu.optionGroupsHint")}
        </span>
      </div>

      {value.map((group, i) => (
        <div key={i} className="tt-modgroup">
          <div className="tt-prodform-row">
            <input
              className="tt-input"
              style={{ flex: 1 }}
              placeholder={t("menu.groupNamePlaceholder")}
              value={group.label}
              onChange={e => patchGroup(i, { label: e.target.value })}
            />
            <select
              className="tt-input"
              style={{ width: 130 }}
              value={group.type}
              aria-label={t("menu.choiceType")}
              onChange={e => patchGroup(i, { type: e.target.value as Modifier["type"] })}
            >
              <option value="single">{t("menu.oneChoice")}</option>
              <option value="multi">{t("menu.anyChoice")}</option>
            </select>
            <button
              type="button"
              className="tt-iconbtn"
              title={t("menu.removeGroup")}
              onClick={() => {
                // The drafts move with their groups. Keyed by position, a
                // half-typed option stayed on its old key and reappeared
                // under the next group down.
                setDrafts(prev => reindexAfterRemoval(prev, i));
                onChange(value.filter((_, idx) => idx !== i));
              }}
            >
              <DeleteIcon size={16} />
            </button>
          </div>

          {/* Required blocks the customer's "Add to cart" until they choose.
              Worth it for the groups a dish can't be cooked without — steak
              doneness, a base for a build-your-own — and a nuisance anywhere
              else, so it's off by default. */}
          <label className="tt-check" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={group.required ?? false}
              onChange={e => patchGroup(i, { required: e.target.checked })}
            />
            <span>
              {t("menu.groupRequired")}{" "}
              <span className="tt-muted" style={{ fontWeight: 400 }}>
                {t("menu.groupRequiredHint")}
              </span>
            </span>
          </label>

          <div className="tt-chips" style={{ marginTop: 8 }}>
            {group.options.map(option => (
              <button
                type="button"
                key={option}
                className="tt-chip tt-chip-on"
                title={t("menu.removeOption")}
                onClick={() =>
                  patchGroup(i, { options: group.options.filter(o => o !== option) })
                }
              >
                {option} <CloseIcon size={11} weight="bold" />
              </button>
            ))}
          </div>

          <div className="tt-prodform-row" style={{ marginTop: 8 }}>
            <input
              className="tt-input"
              style={{ flex: 1 }}
              placeholder={t("menu.addOptionPlaceholder")}
              value={drafts[i] ?? ""}
              onChange={e => setDrafts(prev => ({ ...prev, [i]: e.target.value }))}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOption(i);
                }
              }}
            />
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={() => addOption(i)}
            >
              {t("menu.addBtn")}
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="tt-add-more"
        style={{ marginBottom: 0 }}
        onClick={() => onChange([...value, { label: "", type: "single", options: [] }])}
      >
        {t("menu.addOptionGroup")}
      </button>
    </div>
  );
}
