"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { Category, MenuItem } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import ReorderButtons from "@/components/ui/ReorderButtons";
import MoveToSection from "./MoveToSection";
import ProductForm from "./ProductForm";

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
}: ProductRowProps) {
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const confirm = useConfirm();
  const canMove = !!onMove;
  const linkedNames = linkedAddonIds
    .map((id) => addons.find((a) => a.id === id))
    .filter(Boolean) as MenuItem[];

  const editForm = (
    <ProductForm
      initial={product}
      addons={addons}
      selectedAddonIds={linkedAddonIds}
      currency={currency}
      submitLabel="Save changes"
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
      <div className={`tt-prod ${product.available ? "" : "tt-prod-off"}`}>
        {onReorder && (
          <ReorderButtons
            canMoveUp={!!canReorderUp}
            canMoveDown={!!canReorderDown}
            onMoveUp={() => onReorder(product.id, "up")}
            onMoveDown={() => onReorder(product.id, "down")}
          />
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
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{product.name}</strong>
              {product.popular && <span className="tt-pop">Popular</span>}
              {!product.available && <span className="tt-badge">Unavailable</span>}
            </div>
            {product.description && (
              <div className="tt-desc tt-muted" style={{ margin: "2px 0" }}>{product.description}</div>
            )}
            {linkedNames.length > 0 && (
              <div className="tt-muted" style={{ fontSize: 12 }}>
                + {linkedNames.map((a) => a.name).join(", ")}
              </div>
            )}
          </div>

          <div className="tt-prod-right">
            <strong className="tt-accent">{formatMoney(product.price, currency)}</strong>
            <label className="tt-switch" title={product.available ? "Available" : "Unavailable"}>
              <input
                type="checkbox"
                checked={product.available}
                onChange={(e) => onToggleAvailable(product.id, e.target.checked)}
              />
              <span className="tt-switch-track" />
            </label>
            <div className="tt-prod-actions">
              {canMove && (
                <button className="tt-move-btn" onClick={() => setMoving(true)} title="Move to a section">
                  Move
                </button>
              )}
              <button className="tt-iconbtn" onClick={() => setEditing(true)} title="Edit">✏️</button>
              <button
                className="tt-iconbtn"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete “${product.name}”?`,
                      message: "This can't be undone.",
                      confirmLabel: "Delete",
                      danger: true,
                    })
                  ) {
                    onDelete(product.id);
                  }
                }}
                title="Delete"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
      </div>
      {modalForms && (
        <Modal open={editing} onClose={() => setEditing(false)} maxWidth={720}>
          {editForm}
        </Modal>
      )}
      {canMove && (
        <Modal open={moving} onClose={() => setMoving(false)} maxWidth={460}>
          <MoveToSection
            productName={product.name}
            categories={(categories ?? []).filter((c) => c.id !== product.category_id)}
            onMove={async (categoryId) => {
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
