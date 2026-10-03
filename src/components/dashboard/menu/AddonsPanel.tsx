"use client";

import { useState } from "react";
import type { MenuItem } from "@/lib/types";
import type { AddonInput } from "@/hooks/useMenuEditor";
import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";
import AddonForm from "./AddonForm";
import AddonRow from "./AddonRow";

interface AddonsPanelProps {
  addons: MenuItem[];
  currency: string;
  onAdd: (input: AddonInput) => Promise<void>;
  onUpdate: (id: string, input: AddonInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleAvailable: (id: string, available: boolean) => void;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
  /** Open add/edit forms in a focused modal instead of expanding inline. Defaults to on. */
  modalForms?: boolean;
  /** Lower-cased filter from the editor's search box — narrows the list shown here. */
  searchQuery?: string;
  /** Bulk-select mode: rows show checkboxes. */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

/** Manages the restaurant's reusable add-on items (e.g. Catsup, Extra cheese). */
export default function AddonsPanel({
  addons,
  currency,
  onAdd,
  onUpdate,
  onDelete,
  onToggleAvailable,
  onMove,
  modalForms = true,
  searchQuery = "",
  selectedIds,
  onToggleSelect,
}: AddonsPanelProps) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // A search narrows only what's shown; reorder arrows pause meanwhile.
  const shown = searchQuery
    ? addons.filter(a => a.name.toLowerCase().includes(searchQuery))
    : addons;

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("menu.extrasTitle")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("menu.attachToProducts")}
        </span>
      </div>

      {addons.length === 0 && (
        <p className="tt-muted" style={{ fontSize: 13 }}>
          {t("menu.noExtras")}
        </p>
      )}
      {addons.length > 0 && shown.length === 0 && (
        <p className="tt-muted" style={{ fontSize: 13 }}>
          {t("menu.noExtrasSearch")}
        </p>
      )}

      {/* Above the list: the extras list grows, and the add control
          shouldn't drift further down the page as it does. */}
      {(() => {
        const addForm = (
          <AddonForm
            submitLabel={t("menu.addExtra")}
            onCancel={() => setAdding(false)}
            onSubmit={async input => {
              await onAdd(input);
              setAdding(false);
            }}
          />
        );

        if (modalForms) {
          return (
            <>
              <button className="tt-add-more" onClick={() => setAdding(true)}>
                {t("menu.addExtra")}
              </button>
              <Modal
                open={adding}
                onClose={() => setAdding(false)}
                maxWidth={520}
                title={t("menu.newExtra")}
              >
                {addForm}
              </Modal>
            </>
          );
        }

        return adding ? (
          <div className="tt-prod-editing">{addForm}</div>
        ) : (
          <button className="tt-add-more" onClick={() => setAdding(true)}>
            {t("menu.addExtra")}
          </button>
        );
      })()}

      {shown.map((addon, i) => {
        const isEditing = editingId === addon.id;
        const editForm = (
          <AddonForm
            initial={addon}
            submitLabel={t("menu.saveShort")}
            onCancel={() => setEditingId(null)}
            onSubmit={async input => {
              await onUpdate(addon.id, input);
              setEditingId(null);
            }}
          />
        );

        if (!modalForms && isEditing) {
          return (
            <div key={addon.id} className="tt-addon tt-prod-editing">
              {editForm}
            </div>
          );
        }

        return (
          <div key={addon.id} className="tt-addon">
            <AddonRow
              addon={addon}
              currency={currency}
              canMoveUp={!searchQuery && i > 0}
              canMoveDown={!searchQuery && i < addons.length - 1}
              selectable={Boolean(onToggleSelect)}
              selected={selectedIds?.has(addon.id) ?? false}
              onToggleSelect={() => onToggleSelect?.(addon.id)}
              onEdit={() => setEditingId(addon.id)}
              onToggleAvailable={available => onToggleAvailable(addon.id, available)}
              onMove={direction => void onMove(addon.id, direction)}
              onDelete={() => void onDelete(addon.id)}
            />
            {modalForms && (
              <Modal
                open={isEditing}
                onClose={() => setEditingId(null)}
                maxWidth={520}
                title={t("common.editingNamed", { name: addon.name })}
              >
                {editForm}
              </Modal>
            )}
          </div>
        );
      })}
    </div>
  );
}
