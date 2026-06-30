"use client";

import { useEffect, useState } from "react";
import type { Restaurant } from "@/lib/types";
import { useMenuEditor } from "@/hooks/useMenuEditor";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import Breadcrumb from "@/components/layout/Breadcrumb";
import AddonsPanel from "./AddonsPanel";
import MenusPanel from "./MenusPanel";
import SectionEditor from "./SectionEditor";

/**
 * Full menu management. A restaurant can run several named menus; the top panel
 * switches between them (and toggles each on/off for customers). Everything
 * below — sections, products and extras — belongs to the selected menu only.
 * modalForms: when true (default), adding/editing a product or extra opens in
 * a focused modal one at a time instead of expanding inline in place.
 */
export default function MenuManager({
  restaurant,
  modalForms = true,
}: {
  restaurant: Restaurant;
  modalForms?: boolean;
}) {
  const editor = useMenuEditor(restaurant.id);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [newSection, setNewSection] = useState("");
  const currency = restaurant.currency;

  // Keep a valid menu selected: default to the first, and recover if the
  // selected menu is deleted.
  useEffect(() => {
    if (editor.menus.length === 0) {
      if (selectedMenuId !== null) setSelectedMenuId(null);
      return;
    }
    if (!editor.menus.some((m) => m.id === selectedMenuId)) {
      setSelectedMenuId(editor.menus[0].id);
    }
  }, [editor.menus, selectedMenuId]);

  // Everything below the menu picker is scoped to the selected menu.
  const menuSections = editor.sections.filter((s) => s.menu_id === selectedMenuId);
  const menuProducts = editor.products.filter((p) => p.menu_id === selectedMenuId);
  const menuAddons = editor.addons.filter((a) => a.menu_id === selectedMenuId);

  const sectionIds = new Set(menuSections.map((s) => s.id));
  const uncategorized = menuProducts.filter(
    (p) => !p.category_id || !sectionIds.has(p.category_id)
  );

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Menu" }]} />
        </header>

        {editor.loading || !selectedMenuId ? (
          <div className="tt-menu-grid">
            <SectionSkeleton rows={1} />
            <SectionSkeleton rows={3} />
            <SectionSkeleton rows={2} />
          </div>
        ) : (
          <div className="tt-menu-grid">
            <MenusPanel
              menus={editor.menus}
              selectedMenuId={selectedMenuId}
              onSelect={setSelectedMenuId}
              onAdd={editor.addMenu}
              onRename={editor.renameMenu}
              onDelete={editor.deleteMenu}
              onToggleActive={editor.setMenuActive}
            />

            {/* Step 1 — sections within the selected menu. */}
            <div className="tt-section">
              <div className="tt-section-head">
                <h3 className="tt-serif" style={{ margin: 0 }}>Sections</h3>
              </div>
              <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
                Group this menu — e.g. “Coffee Drinks”. Add a section, then add products (Latte,
                Espresso…) inside it below. Extras come last.
              </p>
              <form
                className="tt-add-section"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (newSection.trim()) {
                    await editor.addSection(selectedMenuId, newSection.trim());
                    setNewSection("");
                  }
                }}
              >
                <input
                  className="tt-input"
                  placeholder="New section name (e.g. Coffee Drinks)"
                  value={newSection}
                  onChange={(e) => setNewSection(e.target.value)}
                />
                <button className="tt-btn tt-btn-primary" type="submit" disabled={!newSection.trim()}>
                  + Add section
                </button>
              </form>
            </div>

            {/* Step 2 — products within each section. */}
            {menuSections.map((section) => (
              <SectionEditor
                key={section.id}
                section={section}
                products={menuProducts.filter((p) => p.category_id === section.id)}
                addons={menuAddons}
                links={editor.links}
                currency={currency}
                onRename={editor.renameSection}
                onDelete={editor.deleteSection}
                onAddProduct={addProductWithAddons}
                onUpdateProduct={updateProductWithAddons}
                onDeleteProduct={editor.deleteProduct}
                onToggleAvailable={editor.setAvailability}
                modalForms={modalForms}
                categories={menuSections}
                onMoveProduct={(productId, categoryId) =>
                  editor.updateProduct(productId, { category_id: categoryId })
                }
                onCreateCategory={(name) => editor.addSection(selectedMenuId, name)}
              />
            ))}

            {uncategorized.length > 0 && (
              <SectionEditor
                section={null}
                products={uncategorized}
                addons={menuAddons}
                links={editor.links}
                currency={currency}
                onRename={async () => {}}
                onDelete={async () => {}}
                onAddProduct={addProductWithAddons}
                onUpdateProduct={updateProductWithAddons}
                onDeleteProduct={editor.deleteProduct}
                onToggleAvailable={editor.setAvailability}
                modalForms={modalForms}
                categories={menuSections}
                onMoveProduct={(productId, categoryId) =>
                  editor.updateProduct(productId, { category_id: categoryId })
                }
                onCreateCategory={(name) => editor.addSection(selectedMenuId, name)}
              />
            )}

            {/* Step 3 — optional add-ons, attached to products in this menu. */}
            <div className="tt-section-head" style={{ marginTop: 8 }}>
              <h3 className="tt-serif" style={{ margin: 0 }}>Extras <span className="tt-muted" style={{ fontWeight: 400, fontSize: 14 }}>(optional)</span></h3>
            </div>
            <AddonsPanel
              addons={menuAddons}
              currency={currency}
              onAdd={(input) => editor.addAddon(selectedMenuId, input)}
              onUpdate={editor.updateAddon}
              onDelete={editor.deleteAddon}
              onToggleAvailable={editor.setAvailability}
              modalForms={modalForms}
            />
          </div>
        )}
      </div>
    </div>
  );

  // Create a product in the selected menu, then attach its chosen add-ons.
  async function addProductWithAddons(
    categoryId: string | null,
    input: Parameters<typeof editor.addProduct>[2],
    addonIds: string[]
  ) {
    const id = await editor.addProduct(selectedMenuId!, categoryId, input);
    if (id && addonIds.length) await editor.setProductAddons(id, addonIds);
  }

  async function updateProductWithAddons(
    id: string,
    input: Parameters<typeof editor.updateProduct>[1],
    addonIds: string[]
  ) {
    await editor.updateProduct(id, input);
    await editor.setProductAddons(id, addonIds);
  }
}
