"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";

interface MoveToSectionProps {
  productName: string;
  categories: Category[];
  onMove: (categoryId: string) => Promise<void>;
  onCreateCategory?: (name: string) => Promise<string | undefined>;
  onCancel: () => void;
}

/** Picker shown for an uncategorized product: choose an existing section or create one. */
export default function MoveToSection({
  productName,
  categories,
  onMove,
  onCreateCategory,
  onCancel,
}: MoveToSectionProps) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        Move “{productName}” to…
      </h3>

      {categories.length > 0 ? (
        <div className="tt-move-list">
          {categories.map(c => (
            <button
              key={c.id}
              className="tt-move-option"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onMove(c.id);
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
          No other sections to move into. Create one below to move this product into it.
        </p>
      )}

      {onCreateCategory && (
        <form
          className="tt-add-section"
          style={{ marginTop: 14 }}
          onSubmit={async e => {
            e.preventDefault();
            if (!newName.trim()) return;
            setBusy(true);
            const id = await onCreateCategory(newName.trim());
            if (id) await onMove(id);
            else setBusy(false);
          }}
        >
          <input
            className="tt-input"
            placeholder="New section name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <button
            className="tt-btn tt-btn-primary tt-btn-sm"
            type="submit"
            disabled={!newName.trim() || busy}
          >
            Create &amp; move
          </button>
        </form>
      )}

      <div className="tt-prodform-actions" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="tt-btn tt-btn-ghost tt-btn-sm"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
