"use client";

import { useState } from "react";
import type { Category, MenuItem } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ProductRow from "./ProductRow";
import ProductForm from "./ProductForm";

/** One menu section (category) with its products and an inline add-product form. */
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
}: {
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
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section?.name ?? "");
  const confirm = useConfirm();

  return (
    <div className="tt-section">
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

      {products.length === 0 && <p className="tt-muted" style={{ fontSize: 13 }}>No products yet.</p>}
      {products.map((p) => (
        <ProductRow
          key={p.id}
          product={p}
          addons={addons}
          linkedAddonIds={links[p.id] ?? []}
          currency={currency}
          onUpdate={onUpdateProduct}
          onDelete={onDeleteProduct}
          onToggleAvailable={onToggleAvailable}
        />
      ))}

      {adding ? (
        <div className="tt-prod tt-prod-editing">
          <ProductForm
            addons={addons}
            currency={currency}
            submitLabel="Add product"
            onCancel={() => setAdding(false)}
            onSubmit={async (input, addonIds) => {
              await onAddProduct(section?.id ?? null, input, addonIds);
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <button className="tt-add-more" onClick={() => setAdding(true)}>+ Add product</button>
      )}
    </div>
  );
}
