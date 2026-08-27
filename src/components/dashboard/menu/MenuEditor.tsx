"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Restaurant } from "@/lib/types";
import type { StoredIconGroup } from "@/lib/icon-groups";
import { useMenuEditor } from "@/hooks/useMenuEditor";
import { useBulkSelect } from "@/hooks/useBulkSelect";
import { useT } from "@/lib/i18n/context";
import BulkBar from "./BulkBar";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import { menuSlug } from "@/lib/slug";
import AddonsPanel from "./AddonsPanel";
import IconGroupsPanel from "./IconGroupsPanel";
import { IconGroupsProvider } from "./IconGroupsContext";
import AddSectionForm from "./AddSectionForm";
import SectionEditor from "./SectionEditor";
import EditorHeader from "./EditorHeader";
import { OrdersIcon } from "@/components/ui/icons";

interface MenuEditorProps {
  restaurant: Restaurant;
  menuId: string;
  menuName: string;
  /** Open add/edit forms in a focused modal instead of expanding inline. Defaults to on. */
  modalForms?: boolean;
  /** The restaurant's own icon-picker groups, from the server. */
  iconGroups?: StoredIconGroup[];
}

/**
 * Editor for a single menu: its sections, products and extras. Reached from the
 * dashboard at /dashboard/{menu-name}. Everything here belongs to this menu only.
 */
export default function MenuEditor({
  restaurant,
  menuId,
  menuName,
  modalForms = true,
  iconGroups = [],
}: MenuEditorProps) {
  const t = useT();
  const editor = useMenuEditor(restaurant.id);
  const currency = restaurant.currency;
  const router = useRouter();
  const [search, setSearch] = useState("");
  const bulk = useBulkSelect();

  // If this menu was deleted from another tab, bounce back to the dashboard
  // instead of showing a dead editor.
  useEffect(() => {
    if (!editor.loading && !editor.menus.some(m => m.id === menuId)) {
      router.replace("/dashboard");
    }
  }, [editor.loading, editor.menus, menuId, router]);

  const currentMenu = editor.menus.find(m => m.id === menuId);
  const liveName = currentMenu?.name ?? menuName;

  const nameTaken = (name: string, exceptId?: string) =>
    editor.menus.some(m => m.id !== exceptId && menuSlug(m.name) === menuSlug(name));

  // Scope everything to this menu.
  const menuSections = editor.sections.filter(s => s.menu_id === menuId);
  const menuProducts = editor.products.filter(p => p.menu_id === menuId);
  const menuAddons = editor.addons.filter(a => a.menu_id === menuId);

  // Client-side search: filters what's SHOWN (products per section + extras);
  // the full addon list still backs the attach-extras forms.
  const q = search.trim().toLowerCase();
  const matches = (name: string, description?: string | null) =>
    !q || name.toLowerCase().includes(q) || (description ?? "").toLowerCase().includes(q);
  const shownProducts = menuProducts.filter(p => matches(p.name, p.description));

  const sectionIds = new Set(menuSections.map(s => s.id));
  const uncategorized = shownProducts.filter(
    p => !p.category_id || !sectionIds.has(p.category_id),
  );
  // While searching, sections with no hits disappear instead of sitting empty.
  const shownSections = q
    ? menuSections.filter(s => shownProducts.some(p => p.category_id === s.id))
    : menuSections;
  const nothingMatches =
    q && shownProducts.length === 0 && !menuAddons.some(a => matches(a.name));

  const menuEmpty = menuSections.length === 0 && menuProducts.length === 0;
  const addSection = (name: string) => editor.addSection(menuId, name);

  return (
    <IconGroupsProvider groups={iconGroups}>
      <div className="tt-dash">
        <div className="container">
          <EditorHeader
            menus={editor.menus}
            menuId={menuId}
            menuName={liveName}
            onRenameMenu={editor.renameMenu}
            nameTaken={nameTaken}
            showTools={!editor.loading && !menuEmpty}
            search={search}
            onSearch={setSearch}
            selecting={bulk.selecting}
            onToggleSelecting={() =>
              bulk.selecting ? bulk.exit() : bulk.setSelecting(true)
            }
          />

          {editor.loading ? (
            <div className="tt-menu-grid">
              <SectionSkeleton rows={1} />
              <SectionSkeleton rows={3} />
              <SectionSkeleton rows={2} />
            </div>
          ) : menuEmpty ? (
            // A fresh menu: invite the first section instead of showing the bare form.
            <div className="tt-section">
              <div className="tt-empty">
                <OrdersIcon size={40} className="tt-empty-icon" />
                <strong>{t("menu.addFirstSection")}</strong>
                <p
                  className="tt-muted"
                  style={{ fontSize: 13, margin: "4px 0 14px", maxWidth: 360 }}
                >
                  {t("menu.addFirstSectionHint", { name: liveName })}
                </p>
                <AddSectionForm onAdd={addSection} autoFocus />
              </div>
            </div>
          ) : (
            <div className="tt-menu-layout">
              <div className="tt-menu-grid">
                {/* Step 1 — sections within this menu. */}
                <div className="tt-section">
                  <div className="tt-section-head">
                    <h3 className="tt-serif" style={{ margin: 0 }}>
                      {t("menu.sections")}
                    </h3>
                  </div>
                  <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
                    {t("menu.sectionsHint")}
                  </p>
                  <AddSectionForm onAdd={addSection} />
                </div>

                {nothingMatches && (
                  <div className="tt-section">
                    <p className="tt-muted" style={{ fontSize: 13, margin: 0 }}>
                      {t("menu.nothingMatches", { q: search.trim() })}
                    </p>
                  </div>
                )}

                {/* Step 2 — products within each section. Reorder arrows pause
                while a search filters the view (indices wouldn't be real). */}
                {shownSections.map((section, i) => (
                  <SectionEditor
                    restaurantId={restaurant.id}
                    key={section.id}
                    section={section}
                    products={shownProducts.filter(p => p.category_id === section.id)}
                    addons={menuAddons}
                    links={editor.links}
                    currency={currency}
                    onRename={editor.renameSection}
                    onDelete={editor.deleteSection}
                    onAddProduct={addProductWithAddons}
                    onUpdateProduct={updateProductWithAddons}
                    onDeleteProduct={editor.deleteProduct}
                    onDuplicateProduct={editor.duplicateProduct}
                    onToggleAvailable={editor.setAvailability}
                    modalForms={modalForms}
                    categories={menuSections}
                    onMoveProduct={(productId, categoryId) =>
                      editor.updateProduct(productId, { category_id: categoryId })
                    }
                    onCreateCategory={addSection}
                    onReorderProduct={editor.moveProduct}
                    canMoveSectionUp={!q && i > 0}
                    canMoveSectionDown={!q && i < menuSections.length - 1}
                    onMoveSection={editor.moveSection}
                    selectedIds={bulk.selecting ? bulk.selected : undefined}
                    onToggleSelect={bulk.selecting ? bulk.toggle : undefined}
                  />
                ))}

                {uncategorized.length > 0 && (
                  <SectionEditor
                    restaurantId={restaurant.id}
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
                    onDuplicateProduct={editor.duplicateProduct}
                    onToggleAvailable={editor.setAvailability}
                    modalForms={modalForms}
                    categories={menuSections}
                    onMoveProduct={(productId, categoryId) =>
                      editor.updateProduct(productId, { category_id: categoryId })
                    }
                    onCreateCategory={addSection}
                    onReorderProduct={editor.moveProduct}
                    selectedIds={bulk.selecting ? bulk.selected : undefined}
                    onToggleSelect={bulk.selecting ? bulk.toggle : undefined}
                  />
                )}
              </div>

              {/* Step 3 — optional add-ons, attached to products in this menu.
                Sits beside the sections on desktop, below them on mobile. */}
              <aside className="tt-menu-side">
                <div className="tt-section-head" style={{ marginTop: 8 }}>
                  <h3 className="tt-serif" style={{ margin: 0 }}>
                    {t("menu.extras")}{" "}
                    <span className="tt-muted" style={{ fontWeight: 400, fontSize: 14 }}>
                      {t("menu.extrasOptional")}
                    </span>
                  </h3>
                </div>
                <AddonsPanel
                  addons={menuAddons}
                  searchQuery={q}
                  selectedIds={bulk.selecting ? bulk.selected : undefined}
                  onToggleSelect={bulk.selecting ? bulk.toggle : undefined}
                  currency={currency}
                  onAdd={input => editor.addAddon(menuId, input)}
                  onUpdate={editor.updateAddon}
                  onDelete={editor.deleteAddon}
                  onToggleAvailable={editor.setAvailability}
                  onMove={editor.moveAddon}
                  modalForms={modalForms}
                />
                <IconGroupsPanel groups={iconGroups} />
              </aside>
            </div>
          )}

          {bulk.selecting && (
            <BulkBar
              count={bulk.selected.size}
              onCancel={bulk.exit}
              onDelete={async () => {
                await editor.deleteItems([...bulk.selected]);
                bulk.exit();
              }}
            />
          )}
        </div>
      </div>
    </IconGroupsProvider>
  );

  // Create a product in this menu, then attach its chosen add-ons.
  async function addProductWithAddons(
    categoryId: string | null,
    input: Parameters<typeof editor.addProduct>[2],
    addonIds: string[],
  ) {
    const id = await editor.addProduct(menuId, categoryId, input);
    if (id && addonIds.length) await editor.setProductAddons(id, addonIds);
  }

  async function updateProductWithAddons(
    id: string,
    input: Parameters<typeof editor.updateProduct>[1],
    addonIds: string[],
  ) {
    await editor.updateProduct(id, input);
    await editor.setProductAddons(id, addonIds);
  }
}
