"use client";

import { useState } from "react";
import type { Category, MenuItem } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import ReorderButtons from "@/components/ui/ReorderButtons";
import ProductRow from "./ProductRow";
import ProductForm from "./ProductForm";

interface SectionEditorProps {
  section: Category | null; // null = "Uncategorized" catch-all
  products: MenuItem[];
  addons: MenuItem[];
  links: Record<string, string[]>;
  currency: string;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddProduct: (categoryId: string | null, input: ProductInput, addonIds: string[]) => Promise<void>;
  onUpdateProduct: (id: string, input: ProductInput, addonIds: string[]) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onToggleAvailable: (id: string, available: boolean) => void;
  /** Open add/edit forms in a focused modal instead of expanding inline. Defaults to on. */
  modalForms?: boolean;
  /** Provided only for the Uncategorized catch-all: lets each product be moved into a real section. */
  categories?: Category[];
  onMoveProduct?: (productId: string, categoryId: string) => Promise<void>;
  onCreateCategory?: (name: string) => Promise<string | undefined>;
  /** Reorders a product up/down within this section. */
  onReorderProduct?: (productId: string, direction: "up" | "down") => Promise<void>;
  /** Reorders this section among its menu's other sections (real sections only). */
  canMoveSectionUp?: boolean;
  canMoveSectionDown?: boolean;
  onMoveSection?: (sectionId: string, direction: "up" | "down") => Promise<void>;
  /** Bulk-select mode: product rows show checkboxes. */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

/** One menu section (category) with its products and an add-product form. */
export default function SectionEditor({
  section,
  products,
  addons,
  links,
  currency,
  onRename,
  onDelete,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onToggleAvailable,
  modalForms = true,
  categories,
  onMoveProduct,
  onCreateCategory,
  onReorderProduct,
  canMoveSectionUp,
  canMoveSectionDown,
  onMoveSection,
  selectedIds,
  onToggleSelect,
}: SectionEditorProps) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section?.name ?? "");
  const confirm = useConfirm();

  return (
    <div className="tt-section tt-section-split">
      <div className="tt-section-left">
        <div className="tt-section-head">
          {section && renaming ? (
            <form
              style={{ display: "flex", gap: 8, flex: 1 }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (name.trim()) await onRename(section.id, name.trim());
                setRenaming(false);
              }}
            >
              <input className="tt-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <button className="tt-btn tt-btn-primary tt-btn-sm" type="submit">Save</button>
            </form>
          ) : (
            <>
              {section && onMoveSection && (
                <ReorderButtons
                  canMoveUp={!!canMoveSectionUp}
                  canMoveDown={!!canMoveSectionDown}
                  onMoveUp={() => onMoveSection(section.id, "up")}
                  onMoveDown={() => onMoveSection(section.id, "down")}
                />
              )}
              <h3 className="tt-serif" style={{ margin: 0 }}>{section ? section.name : "Uncategorized"}</h3>
              {section && (
                <div className="tt-prod-actions">
                  <button className="tt-iconbtn" title="Rename" onClick={() => { setName(section.name); setRenaming(true); }}>✏️</button>
                  <button
                    className="tt-iconbtn"
                    title="Delete section"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Delete section “${section.name}”?`,
                          message: "Its products move to Uncategorized.",
                          confirmLabel: "Delete",
                          danger: true,
                        })
                      ) {
                        onDelete(section.id);
                      }
                    }}
                  >
                    🗑️
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="tt-section-right">
        {products.length === 0 && <p className="tt-muted" style={{ fontSize: 13 }}>No products yet.</p>}
        {products.map((p, i) => (
          <ProductRow
            key={p.id}
            product={p}
            addons={addons}
            linkedAddonIds={links[p.id] ?? []}
            currency={currency}
            onUpdate={onUpdateProduct}
            onDelete={onDeleteProduct}
            onToggleAvailable={onToggleAvailable}
            modalForms={modalForms}
            categories={categories}
            onMove={onMoveProduct}
            onCreateCategory={onCreateCategory}
            canReorderUp={i > 0}
            canReorderDown={i < products.length - 1}
            onReorder={onReorderProduct}
            selected={selectedIds?.has(p.id) ?? false}
            onToggleSelect={onToggleSelect}
          />
        ))}

        {/* The Uncategorized catch-all (section === null) isn't a real category,
            so no products can be added to it — only orphans land here. */}
        {section &&
          (() => {
            const addForm = (
              <ProductForm
                addons={addons}
                currency={currency}
                submitLabel="Add product"
                onCancel={() => setAdding(false)}
                onSubmit={async (input, addonIds) => {
                  await onAddProduct(section.id, input, addonIds);
                  setAdding(false);
                }}
              />
            );

            if (modalForms) {
              return (
                <>
                  <button className="tt-add-more" onClick={() => setAdding(true)}>+ Add product</button>
                  <Modal open={adding} onClose={() => setAdding(false)} maxWidth={720}>
                    {addForm}
                  </Modal>
                </>
              );
            }

            return adding ? (
              <div className="tt-prod tt-prod-editing">{addForm}</div>
            ) : (
              <button className="tt-add-more" onClick={() => setAdding(true)}>+ Add product</button>
            );
          })()}
      </div>
    </div>
  );
}
