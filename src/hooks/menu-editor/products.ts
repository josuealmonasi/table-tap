import type { MenuItem } from "@/lib/types";
import type { EditorContext, ProductInput } from "./types";

/** Products: add, copy, edit, delete, reorder within their section. */
export function productActions(ctx: EditorContext) {
  const { supabase, restaurantId, sections, products, links, reload } = ctx;
  const { reportError, run, insertReturningId, move } = ctx.w;
  // ── Products ──
  const addProduct = (menuId: string, categoryId: string | null, input: ProductInput) =>
    insertReturningId(
      "write.createProduct",
      "menu_items",
      {
        restaurant_id: restaurantId,
        menu_id: menuId,
        category_id: categoryId,
        is_addon: false,
        sort_order: products.filter(p => p.menu_id === menuId).length,
        ...input,
      },
      "done.productAdded",
    );
  /**
   * Copies a product, its options and its add-on links, into the same section.
   *
   * A menu often carries six versions of one dish — the same burger at three
   * sizes, the same coffee with four milks — and rebuilding the modifier
   * groups by hand each time is the slow part. The copy lands right after the
   * original so it is where the eye already is, and carries "copy" in its name
   * so nobody serves the wrong one while it is being edited.
   */
  async function duplicateProduct(id: string): Promise<string | undefined> {
    const source = products.find(p => p.id === id);
    if (!source) return undefined;

    const taken = new Set(
      products.filter(p => p.menu_id === source.menu_id).map(p => p.name.toLowerCase()),
    );
    let name = `${source.name} copy`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${source.name} copy ${n}`;

    const newId = await insertReturningId(
      "write.createProduct",
      "menu_items",
      {
        restaurant_id: restaurantId,
        menu_id: source.menu_id,
        category_id: source.category_id,
        is_addon: false,
        name,
        description: source.description,
        price: source.price,
        emoji: source.emoji,
        image_url: source.image_url,
        popular: source.popular,
        available: source.available,
        modifiers: source.modifiers,
        dietary: source.dietary,
        discount_pct: source.discount_pct,
        skips_kitchen: source.skips_kitchen,
        // `stock` is deliberately NOT copied: the copy starts untracked. Two
        // dishes each claiming the same twenty portions is twenty portions the
        // kitchen does not have, and a duplicate is a new thing to count.
        // Straight after the original, not at the end of the section.
        sort_order: source.sort_order + 1,
      },
      "done.productDuplicated",
    );
    if (!newId) return undefined;

    // The extras it offers come with it — rebuilding those by hand is the
    // tedious half of copying a dish.
    const addonIds = links[id] ?? [];
    if (addonIds.length > 0) {
      // Said, not swallowed: the copy was announced as made, and one that lost
      // its extras on the way would otherwise be found by a diner.
      const { error } = await supabase
        .from("item_addons")
        .insert(
          addonIds.map((addon_id, i) => ({ product_id: newId, addon_id, sort_order: i })),
        );
      reportError("write.updateProductExtras", error);
    }

    await reload();
    return newId;
  }

  const updateProduct = (
    id: string,
    input: Partial<ProductInput & { category_id: string | null }>,
  ) =>
    run(
      "write.updateProduct",
      supabase.from("menu_items").update(input).eq("id", id),
      "done.productUpdated",
    );
  const deleteProduct = (id: string) =>
    run(
      "write.deleteProduct",
      supabase.from("menu_items").delete().eq("id", id),
      "done.productDeleted",
    );

  /** Moves a product up/down among its siblings (same menu + same section, including "uncategorized"). */
  async function moveProduct(id: string, direction: "up" | "down"): Promise<void> {
    const product = products.find(p => p.id === id);
    if (!product) return;
    const sectionIds = new Set(sections.map(s => s.id));
    const inSameGroup = (p: MenuItem) =>
      p.menu_id === product.menu_id &&
      (product.category_id && sectionIds.has(product.category_id)
        ? p.category_id === product.category_id
        : !p.category_id || !sectionIds.has(p.category_id));
    await move(
      "write.reorderProducts",
      "menu_items",
      products.filter(inSameGroup),
      id,
      direction,
    );
  }

  return { addProduct, duplicateProduct, updateProduct, deleteProduct, moveProduct };
}
