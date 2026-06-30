"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Restaurant } from "@/lib/types";
import { useMenuEditor } from "@/hooks/useMenuEditor";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import { menuSlug } from "@/lib/slug";
import Link from "next/link";
import AddonsPanel from "./AddonsPanel";
import SectionEditor from "./SectionEditor";
import MenuSwitcher from "./MenuSwitcher";

/**
 * Editor for a single menu: its sections, products and extras. Reached from the
 * dashboard at /dashboard/{menu-name}. Everything here belongs to this menu only.
 * modalForms: when true (default), adding/editing a product or extra opens in a
 * focused modal one at a time instead of expanding inline in place.
 */
export default function MenuEditor({
  restaurant,
  menuId,
  menuName,
  modalForms = true,
}: {
  restaurant: Restaurant;
  menuId: string;
  menuName: string;
  modalForms?: boolean;
}) {
  const editor = useMenuEditor(restaurant.id);
  const [newSection, setNewSection] = useState("");
  const currency = restaurant.currency;
  const router = useRouter();

  // If this menu was deleted from another tab, bounce back to the dashboard
  // instead of showing a dead editor.
  useEffect(() => {
    if (!editor.loading && !editor.menus.some((m) => m.id === menuId)) {
      router.replace("/dashboard");
    }
  }, [editor.loading, editor.menus, menuId, router]);

  const currentMenu = editor.menus.find((m) => m.id === menuId);
  const liveName = currentMenu?.name ?? menuName;

  const nameTaken = (name: string, exceptId?: string) =>
    editor.menus.some((m) => m.id !== exceptId && menuSlug(m.name) === menuSlug(name));

  // Scope everything to this menu.
  const menuSections = editor.sections.filter((s) => s.menu_id === menuId);
  const menuProducts = editor.products.filter((p) => p.menu_id === menuId);
  const menuAddons = editor.addons.filter((a) => a.menu_id === menuId);

  const sectionIds = new Set(menuSections.map((s) => s.id));
  const uncategorized = menuProducts.filter(
    (p) => !p.category_id || !sectionIds.has(p.category_id)
  );

  const menuEmpty = menuSections.length === 0 && menuProducts.length === 0;

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <nav className="tt-breadcrumb" aria-label="Breadcrumb">
            <Link href="/dashboard">Dashboard</Link>
            <span className="tt-breadcrumb-sep">/</span>
            <MenuSwitcher
              menus={editor.menus}
              currentId={menuId}
              currentName={liveName}
              onRename={editor.renameMenu}
              nameTaken={nameTaken}
            />
          </nav>
        </header>

        {editor.loading ? (
          <div className="tt-menu-grid">
            <SectionSkeleton rows={1} />
            <SectionSkeleton rows={3} />
            <SectionSkeleton rows={2} />
          </div>
        ) : menuEmpty ? (
          <div className="tt-section">
            <div className="tt-empty">
              <div className="tt-empty-emoji">🍽️</div>
              <strong>Add your first section</strong>
              <p className="tt-muted" style={{ fontSize: 13, margin: "4px 0 14px", maxWidth: 360 }}>
                Group “{liveName}” into sections — e.g. “Coffee Drinks” — then add products
                (Latte, Espresso…) inside each one.
              </p>
              <form
                className="tt-add-section"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (newSection.trim()) {
                    await editor.addSection(menuId, newSection.trim());
                    setNewSection("");
                  }
                }}
              >
                <input
                  className="tt-input"
                  placeholder="New section name (e.g. Coffee Drinks)"
                  value={newSection}
                  onChange={(e) => setNewSection(e.target.value)}
                  autoFocus
                />
                <button className="tt-btn tt-btn-primary" type="submit" disabled={!newSection.trim()}>
                  + Add section
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="tt-menu-grid">
            {/* Step 1 — sections within this menu. */}
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
                    await editor.addSection(menuId, newSection.trim());
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
            {menuSections.map((section, i) => (
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
                onCreateCategory={(name) => editor.addSection(menuId, name)}
                onReorderProduct={editor.moveProduct}
                canMoveSectionUp={i > 0}
                canMoveSectionDown={i < menuSections.length - 1}
                onMoveSection={editor.moveSection}
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
                onCreateCategory={(name) => editor.addSection(menuId, name)}
                onReorderProduct={editor.moveProduct}
              />
            )}

            {/* Step 3 — optional add-ons, attached to products in this menu. */}
            <div className="tt-section-head" style={{ marginTop: 8 }}>
              <h3 className="tt-serif" style={{ margin: 0 }}>Extras <span className="tt-muted" style={{ fontWeight: 400, fontSize: 14 }}>(optional)</span></h3>
            </div>
            <AddonsPanel
              addons={menuAddons}
              currency={currency}
              onAdd={(input) => editor.addAddon(menuId, input)}
              onUpdate={editor.updateAddon}
              onDelete={editor.deleteAddon}
              onToggleAvailable={editor.setAvailability}
              onMove={editor.moveAddon}
              modalForms={modalForms}
            />
          </div>
        )}
      </div>
    </div>
  );

  // Create a product in this menu, then attach its chosen add-ons.
  async function addProductWithAddons(
    categoryId: string | null,
    input: Parameters<typeof editor.addProduct>[2],
    addonIds: string[]
  ) {
    const id = await editor.addProduct(menuId, categoryId, input);
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
