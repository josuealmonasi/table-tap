"use client";

import { useState } from "react";
import type { Category, MenuItem } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";
import ReorderButtons from "@/components/ui/ReorderButtons";
import ProductRow from "./ProductRow";
import ProductForm from "./ProductForm";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";

interface SectionEditorProps {
  restaurantId: string;
  section: Category | null; // null = "Uncategorized" catch-all
  products: MenuItem[];
  /** Whether the plan includes counting stock. */
  inventoryAllowed?: boolean;
  addons: MenuItem[];
  links: Record<string, string[]>;
  currency: string;
  onRename: (id: string, name: string) => Promise<boolean>;
  /** Where the section's dishes are made; absent for the uncategorized bucket. */
  onSetStation?: (id: string, station: "kitchen" | "bar") => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onAddProduct: (
    categoryId: string | null,
    input: ProductInput,
    addonIds: string[],
  ) => Promise<void>;
  onUpdateProduct: (id: string, input: ProductInput, addonIds: string[]) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<boolean>;
  onDuplicateProduct?: (id: string) => Promise<string | undefined>;
  onToggleAvailable: (id: string, available: boolean) => void;
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
  restaurantId,
  section,
  products,
  inventoryAllowed = false,
  addons,
  links,
  currency,
  onRename,
  onSetStation,
  onDelete,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onDuplicateProduct,
  onToggleAvailable,
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
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const [name, setName] = useState(section?.name ?? "");

  const nameChanged = Boolean(section && name.trim() && name.trim() !== section.name);

  function cancelRename() {
    setName(section?.name ?? "");
    setRenaming(false);
  }
  const confirm = useConfirm();

  return (
    <div className="tt-section tt-section-split">
      <div className="tt-section-left">
        <div className="tt-section-head">
          {section && renaming ? (
            <form
              style={{ display: "flex", gap: 8, flex: 1 }}
              // Escape and clicking away both abandon the edit, which is what
              // every other text field on the page does. Without it the only
              // way out was to save something.
              onBlur={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) cancelRename();
              }}
              onKeyDown={e => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              onSubmit={async e => {
                e.preventDefault();
                if (!nameChanged) return;
                if (!(await onRename(section.id, name.trim()))) return;
                setRenaming(false);
              }}
            >
              <input
                className="tt-input"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
              <button
                className="tt-btn tt-btn-primary tt-btn-sm"
                type="submit"
                // A tap on a button does not focus it on iOS, so the form's
                // blur fires with no relatedTarget and the edit was abandoned
                // before the click could land — on a phone the only way to
                // save was the keyboard's enter key. Holding the press stops
                // the blur, so the click reaches the button it was aimed at.
                onPointerDown={e => e.preventDefault()}
                // Nothing to save until the name actually differs; an enabled
                // Save that does nothing reads as a broken button.
                disabled={!nameChanged}
              >
                {t("menu.save")}
              </button>
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
              <h3 className="tt-serif" style={{ margin: 0 }}>
                {section ? section.name : t("menu.uncategorized")}
              </h3>
              {section && (
                <div className="tt-prod-actions">
                  {/* Where these dishes are made: the bar's screen shows the bar. */}
                  {onSetStation && (
                    <select
                      className="tt-input tt-station-select"
                      value={section.station ?? "kitchen"}
                      aria-label={t("stations.madeAt")}
                      title={t("stations.madeAt")}
                      onChange={e => void onSetStation(section.id, e.target.value === "bar" ? "bar" : "kitchen")}
                    >
                      <option value="kitchen">{t("stations.kitchen")}</option>
                      <option value="bar">{t("stations.bar")}</option>
                    </select>
                  )}
                  <button
                    className="tt-iconbtn"
                    title={t("menu.rename")}
                    onClick={() => {
                      setName(section.name);
                      setRenaming(true);
                    }}
                  >
                    <EditIcon size={16} />
                  </button>
                  <button
                    className="tt-iconbtn"
                    title={t("menu.deleteSection")}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: t("menu.deleteSectionConfirm", { name: section.name }),
                          message: t("menu.productsMoveUncategorized"),
                          confirmLabel: t("menu.delete"),
                          danger: true,
                        })
                      ) {
                        onDelete(section.id);
                      }
                    }}
                  >
                    <DeleteIcon size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="tt-section-right">
        {/* Add control first: a busy section can run to hundreds of products,
            and scrolling past all of them to add one more is punishing.
            The Uncategorized catch-all (section === null) isn't a real
            category, so nothing can be added to it — only orphans land there. */}
        {section &&
          (() => {
            const addForm = (
              <ProductForm
                restaurantId={restaurantId}
                inventoryAllowed={inventoryAllowed}
                addons={addons}
                currency={currency}
                submitLabel={t("menu.addProduct")}
                onCancel={() => setAdding(false)}
                onSubmit={async (input, addonIds) => {
                  await onAddProduct(section.id, input, addonIds);
                  setAdding(false);
                }}
              />
            );

            return (
              <>
                <button className="tt-add-more" onClick={() => setAdding(true)}>
                  {t("menu.addProduct")}
                </button>
                <Modal
                  open={adding}
                  onClose={() => setAdding(false)}
                  maxWidth={720}
                  title={t("menu.newProduct")}
                >
                  {addForm}
                </Modal>
              </>
            );
          })()}

        {products.length === 0 && (
          <p className="tt-muted" style={{ fontSize: 13 }}>
            {t("menu.noProducts")}
          </p>
        )}
        {products.map((p, i) => (
          <ProductRow
            restaurantId={restaurantId}
            inventoryAllowed={inventoryAllowed}
            key={p.id}
            product={p}
            addons={addons}
            linkedAddonIds={links[p.id] ?? []}
            currency={currency}
            onUpdate={onUpdateProduct}
            onDelete={onDeleteProduct}
            onDuplicate={onDuplicateProduct}
            onToggleAvailable={onToggleAvailable}
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
      </div>
    </div>
  );
}
