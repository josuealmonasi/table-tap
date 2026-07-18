"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import { useT } from "@/lib/i18n/context";

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
  const t = useT();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {t("menu.moveTo", { name: productName })}
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
          {t("menu.noSections")}
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
            placeholder={t("menu.newSectionPlaceholder2")}
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <button
            className="tt-btn tt-btn-primary tt-btn-sm"
            type="submit"
            disabled={!newName.trim() || busy}
          >
            {t("menu.createAndMove")}
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
          {t("menu.cancel")}
        </button>
      </div>
    </div>
  );
}
