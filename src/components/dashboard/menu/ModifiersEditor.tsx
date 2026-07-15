"use client";

import { useState } from "react";
import type { Modifier } from "@/lib/types";

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
        Option groups{" "}
        <span className="tt-muted" style={{ fontWeight: 400 }}>
          (e.g. “Spice level” — customers pick when ordering)
        </span>
      </div>

      {value.map((group, i) => (
        <div key={i} className="tt-modgroup">
          <div className="tt-prodform-row">
            <input
              className="tt-input"
              style={{ flex: 1 }}
              placeholder="Group name (e.g. Spice level)"
              value={group.label}
              onChange={e => patchGroup(i, { label: e.target.value })}
            />
            <select
              className="tt-input"
              style={{ width: 130 }}
              value={group.type}
              aria-label="Choice type"
              onChange={e =>
                patchGroup(i, { type: e.target.value as Modifier["type"] })
              }
            >
              <option value="single">One choice</option>
              <option value="multi">Any</option>
            </select>
            <button
              type="button"
              className="tt-iconbtn"
              title="Remove group"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              🗑️
            </button>
          </div>

          <div className="tt-chips" style={{ marginTop: 8 }}>
            {group.options.map(option => (
              <button
                type="button"
                key={option}
                className="tt-chip tt-chip-on"
                title="Remove option"
                onClick={() =>
                  patchGroup(i, { options: group.options.filter(o => o !== option) })
                }
              >
                {option} ✕
              </button>
            ))}
          </div>

          <div className="tt-prodform-row" style={{ marginTop: 8 }}>
            <input
              className="tt-input"
              style={{ flex: 1 }}
              placeholder="Add an option (e.g. Mild) and press Enter"
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
              + Add
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
        + Add option group
      </button>
    </div>
  );
}
