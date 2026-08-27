"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
import type { AddonInput } from "@/hooks/useMenuEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import { useDirty } from "@/hooks/useDirty";
import { Modal } from "@/components/ui/Modal";
import ReorderButtons from "@/components/ui/ReorderButtons";
import IconPicker from "./IconPicker";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";

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
  const confirm = useConfirm();

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
            <div
              className={`tt-prod ${addon.available ? "" : "tt-prod-off"} ${selectedIds?.has(addon.id) ? "tt-prod-selected" : ""}`}
            >
              {onToggleSelect ? (
                <input
                  type="checkbox"
                  className="tt-bulk-check"
                  checked={selectedIds?.has(addon.id) ?? false}
                  aria-label={t("menu.selectItem", { name: addon.name })}
                  onChange={() => onToggleSelect(addon.id)}
                />
              ) : (
                <ReorderButtons
                  canMoveUp={!searchQuery && i > 0}
                  canMoveDown={!searchQuery && i < addons.length - 1}
                  onMoveUp={() => onMove(addon.id, "up")}
                  onMoveDown={() => onMove(addon.id, "down")}
                />
              )}
              <div className="tt-prod-body">
                <div className="tt-prod-thumb">
                  <span>{addon.emoji || addon.name.charAt(0).toUpperCase()}</span>
                </div>
                <div style={{ flex: 1 }}>
                  {/* El nombre abre el editor, igual que en un producto: el
                      lápiz sigue ahí, pero nadie lo busca cuando lo que quiere
                      cambiar es justo lo que está leyendo. Misma clase, para
                      que se comporte igual y no haya un segundo estilo que
                      mantener. */}
                  <button
                    type="button"
                    className="tt-prod-name"
                    onClick={() => setEditingId(addon.id)}
                    title={t("menu.edit")}
                  >
                    {addon.name}
                  </button>
                  {!addon.available && (
                    <span className="tt-badge" style={{ marginLeft: 6 }}>
                      {t("menu.unavailable")}
                    </span>
                  )}
                </div>
                <div className="tt-prod-right">
                  <strong className="tt-accent">
                    {formatMoney(addon.price, currency)}
                  </strong>
                  <label
                    className="tt-switch"
                    title={t(addon.available ? "menu.available" : "menu.unavailable")}
                  >
                    <input
                      type="checkbox"
                      checked={addon.available}
                      onChange={e => onToggleAvailable(addon.id, e.target.checked)}
                    />
                    <span className="tt-switch-track" />
                  </label>
                  <div className="tt-prod-actions">
                    <button
                      className="tt-iconbtn"
                      title={t("menu.edit")}
                      onClick={() => setEditingId(addon.id)}
                    >
                      <EditIcon size={16} />
                    </button>
                    <button
                      className="tt-iconbtn"
                      title={t("menu.delete")}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: t("menu.deleteExtraConfirm", { name: addon.name }),
                            confirmLabel: t("menu.delete"),
                            danger: true,
                          })
                        ) {
                          onDelete(addon.id);
                        }
                      }}
                    >
                      <DeleteIcon size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
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

interface AddonFormProps {
  initial?: MenuItem;
  submitLabel: string;
  onSubmit: (input: AddonInput) => Promise<void>;
  onCancel: () => void;
}

/** Small inline form for creating/editing an add-on item. */
function AddonForm({ initial, submitLabel, onSubmit, onCancel }: AddonFormProps) {
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
