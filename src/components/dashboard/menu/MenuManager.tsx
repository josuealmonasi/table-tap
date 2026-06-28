"use client";

import { useState } from "react";
import Link from "next/link";
import type { Restaurant } from "@/lib/types";
import { useMenuEditor } from "@/hooks/useMenuEditor";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import AddonsPanel from "./AddonsPanel";
import SectionEditor from "./SectionEditor";

/** Full menu management: add-on items, sections, and the products within them. */
export default function MenuManager({ restaurant }: { restaurant: Restaurant }) {
  const editor = useMenuEditor(restaurant.id);
  const [newSection, setNewSection] = useState("");
  const currency = restaurant.currency;

  // Products grouped by section, plus a catch-all for any without a section.
  const sectionIds = new Set(editor.sections.map((s) => s.id));
  const uncategorized = editor.products.filter(
    (p) => !p.category_id || !sectionIds.has(p.category_id)
  );

  return (
    <div className="tt-dash">
      <header className="tt-dash-head">
        <div>
          <h1 className="tt-serif" style={{ margin: 0 }}>Menu</h1>
          <Link href="/dashboard" className="tt-muted" style={{ fontSize: 13 }}>← {restaurant.name} dashboard</Link>
        </div>
      </header>

      {editor.loading ? (
        <div className="tt-menu-grid">
          <SectionSkeleton rows={1} />
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={2} />
        </div>
      ) : (
        <div className="tt-menu-grid">
          {/* Step 1 — sections. The starting point: create a section, then add products to it. */}
          <div className="tt-section">
            <div className="tt-section-head">
              <h3 className="tt-serif" style={{ margin: 0 }}>Sections</h3>
            </div>
            <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
              Group your menu — e.g. “Coffee Drinks”. Add a section, then add products (Latte,
              Espresso…) inside it below. Extras come last.
            </p>
            <form
              className="tt-add-section"
              onSubmit={async (e) => {
                e.preventDefault();
                if (newSection.trim()) {
                  await editor.addSection(newSection.trim());
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
          {editor.sections.map((section) => (
            <SectionEditor
              key={section.id}
              section={section}
              products={editor.products.filter((p) => p.category_id === section.id)}
              addons={editor.addons}
              links={editor.links}
              currency={currency}
              onRename={editor.renameSection}
              onDelete={editor.deleteSection}
              onAddProduct={addProductWithAddons}
              onUpdateProduct={updateProductWithAddons}
              onDeleteProduct={editor.deleteProduct}
              onToggleAvailable={editor.setAvailability}
            />
          ))}

          {uncategorized.length > 0 && (
            <SectionEditor
              section={null}
              products={uncategorized}
              addons={editor.addons}
              links={editor.links}
              currency={currency}
              onRename={async () => {}}
              onDelete={async () => {}}
              onAddProduct={addProductWithAddons}
              onUpdateProduct={updateProductWithAddons}
              onDeleteProduct={editor.deleteProduct}
              onToggleAvailable={editor.setAvailability}
            />
          )}

          {/* Step 3 — optional add-ons, attached to products. */}
          <div className="tt-section-head" style={{ marginTop: 8 }}>
            <h3 className="tt-serif" style={{ margin: 0 }}>Extras <span className="tt-muted" style={{ fontWeight: 400, fontSize: 14 }}>(optional)</span></h3>
          </div>
          <AddonsPanel
            addons={editor.addons}
            currency={currency}
            onAdd={editor.addAddon}
            onUpdate={editor.updateAddon}
            onDelete={editor.deleteAddon}
            onToggleAvailable={editor.setAvailability}
          />
        </div>
      )}
    </div>
  );

  // Create a product, then attach its chosen add-ons.
  async function addProductWithAddons(
    categoryId: string | null,
    input: Parameters<typeof editor.addProduct>[1],
    addonIds: string[]
  ) {
    const id = await editor.addProduct(categoryId, input);
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
