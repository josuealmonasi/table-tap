"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { Category, MenuItem } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";
import ReorderButtons from "@/components/ui/ReorderButtons";
import MoveToSection from "./MoveToSection";
import ProductForm from "./ProductForm";
import { Icon } from "@/components/ui/icons";

interface ProductRowProps {
  product: MenuItem;
  addons: MenuItem[];
  linkedAddonIds: string[];
  currency: string;
  onUpdate: (id: string, input: ProductInput, addonIds: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleAvailable: (id: string, available: boolean) => void;
  /** Open the edit form in a focused modal instead of expanding inline. Defaults to on. */
  modalForms?: boolean;
  /** When provided (uncategorized products only), shows a "move to section" action. */
  categories?: Category[];
  onMove?: (productId: string, categoryId: string) => Promise<void>;
  onCreateCategory?: (name: string) => Promise<string | undefined>;
  /** Up/down position within this product's section, for reordering. */
  canReorderUp?: boolean;
  canReorderDown?: boolean;
  onReorder?: (productId: string, direction: "up" | "down") => Promise<void>;
  /** Bulk-select mode: shows a checkbox instead of the reorder arrows. */
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

/** One product in a section: image/emoji, price, availability switch, add-ons, edit/delete. */
export default function ProductRow({
  product,
  addons,
  linkedAddonIds,
  currency,
  onUpdate,
  onDelete,
  onToggleAvailable,
  modalForms = true,
  categories,
  onMove,
  onCreateCategory,
  canReorderUp,
  canReorderDown,
  onReorder,
  selected = false,
  onToggleSelect,
}: ProductRowProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const confirm = useConfirm();
  const canMove = !!onMove;
  const linkedNames = linkedAddonIds
    .map(id => addons.find(a => a.id === id))
    .filter(Boolean) as MenuItem[];

  const editForm = (
    <ProductForm
      initial={product}
      addons={addons}
      selectedAddonIds={linkedAddonIds}
      currency={currency}
      submitLabel={t("menu.saveChanges")}
      onCancel={() => setEditing(false)}
      onSubmit={async (input, addonIds) => {
        await onUpdate(product.id, input, addonIds);
        setEditing(false);
      }}
    />
  );

  // Inline mode: editing replaces the row entirely with the form.
  if (!modalForms && editing) {
    return <div className="tt-prod tt-prod-editing">{editForm}</div>;
  }

  return (
    <>
      <div
        className={`tt-prod ${product.available ? "" : "tt-prod-off"} ${selected ? "tt-prod-selected" : ""}`}
      >
        {onToggleSelect ? (
          <input
            type="checkbox"
            className="tt-bulk-check"
            checked={selected}
            aria-label={t("menu.selectItem", { name: product.name })}
            onChange={() => onToggleSelect(product.id)}
          />
        ) : (
          onReorder && (
            <ReorderButtons
              canMoveUp={!!canReorderUp}
              canMoveDown={!!canReorderDown}
              onMoveUp={() => onReorder(product.id, "up")}
              onMoveDown={() => onReorder(product.id, "down")}
            />
          )
        )}
        <div className="tt-prod-body">
          <div className="tt-prod-thumb">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt={product.name} />
            ) : (
              <span>{product.emoji || "🍽️"}</span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
            >
              <strong>{product.name}</strong>
              {product.popular && <span className="tt-pop">{t("menu.popular")}</span>}
              {!product.available && (
                <span className="tt-badge">{t("menu.unavailable")}</span>
              )}
            </div>
            {product.description && (
              <div className="tt-desc tt-muted" style={{ margin: "2px 0" }}>
                {product.description}
              </div>
            )}
            {linkedNames.length > 0 && (
              <div className="tt-muted" style={{ fontSize: 12 }}>
                + {linkedNames.map(a => a.name).join(", ")}
              </div>
            )}
          </div>

          <div className="tt-prod-right">
            <strong className="tt-accent">{formatMoney(product.price, currency)}</strong>
            <label
              className="tt-switch"
              title={t(product.available ? "menu.available" : "menu.unavailable")}
            >
              <input
                type="checkbox"
                checked={product.available}
                onChange={e => onToggleAvailable(product.id, e.target.checked)}
              />
              <span className="tt-switch-track" />
            </label>
            <div className="tt-prod-actions">
              {canMove && (
                <button
                  className="tt-iconbtn"
                  onClick={() => setMoving(true)}
                  title={t("menu.moveToSection")}
                >
                  <Icon.MoveTo size={16} />
                </button>
              )}
              <button
                className="tt-iconbtn"
                onClick={() => setEditing(true)}
                title={t("menu.edit")}
              >
                <Icon.Edit size={16} />
              </button>
              <button
                className="tt-iconbtn"
                onClick={async () => {
                  if (
                    await confirm({
                      title: t("menu.deleteProductConfirm", { name: product.name }),
                      message: t("menu.cantUndo"),
                      confirmLabel: t("menu.delete"),
                      danger: true,
                    })
                  ) {
                    onDelete(product.id);
                  }
                }}
                title={t("menu.delete")}
              >
                <Icon.Delete size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
      {modalForms && (
        <Modal
          open={editing}
          onClose={() => setEditing(false)}
          maxWidth={720}
          label={t("menu.edit")}
        >
          {editForm}
        </Modal>
      )}
      {canMove && (
        <Modal
          open={moving}
          onClose={() => setMoving(false)}
          maxWidth={460}
          label={t("menu.moveToSection")}
        >
          <MoveToSection
            productName={product.name}
            categories={(categories ?? []).filter(c => c.id !== product.category_id)}
            onMove={async categoryId => {
              await onMove!(product.id, categoryId);
              setMoving(false);
            }}
            onCreateCategory={onCreateCategory}
            onCancel={() => setMoving(false)}
          />
        </Modal>
      )}
    </>
  );
}
