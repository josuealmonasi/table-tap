import { MARK } from "../api-fixtures.mjs";
import { arrangeMenuCopy, checkMenuCopy } from "../api-menu-copy.mjs";
import { promoId, dietaryTagId, iconGroupId, couponId } from "./helpers.mjs";

export function menuCopyCases() {
  return [
    { name: "POST /api/menu/duplicate (copy and remove the copy)", as: "manager", method: "POST",
      path: "/api/menu/duplicate",
      arrange: arrangeMenuCopy,
      body: f => ({ sourceId: f.s14MenuSource }),
      expect: [200], check: checkMenuCopy },
  ];
}

export function productCases(fx) {
  const { restaurant, dish } = fx;
  const r = restaurant.id;
  return [
    { name: "PATCH /api/products (J5: an unrelated edit preserves stock)",
      as: "manager", method: "PATCH", path: "/api/products",
      arrange: async f => {
        const { data: item, error } = await f.admin.from("menu_items").select("description, stock")
          .eq("id", f.dish.id).single();
        if (error || !item) throw new Error("Could not read the product before editing");
        f.productBeforeEdit = item;
        return async () => {
          const { error: restoreError } = await f.admin.from("menu_items")
            .update({ description: item.description }).eq("id", f.dish.id);
          if (restoreError) throw new Error(restoreError.message);
        };
      },
      body: f => ({ id: f.dish.id, changes: { description: `${MARK} description`,
        stock: (f.productBeforeEdit.stock ?? 0) + 3 } }), expect: [200],
      check: async (_data, f) => {
        const { data: item, error } = await f.admin.from("menu_items").select("description, stock")
          .eq("id", f.dish.id).single();
        if (error || !item) return "could not verify the saved product";
        if (item.stock !== f.productBeforeEdit.stock) return "an unrelated edit changed stock";
        if (item.description !== `${MARK} description`) return "the description was not saved";
        return true;
      } },
    // S23 K11: a dish and its extras are one write (save_product_addons_v1).
    // A failed link insert used to leave the dish with no extras at all.
    ...(() => {
      const made = [];
      const extra = async (f, name) => {
        const { data: dishRow, error: readError } = await f.admin.from("menu_items").select("menu_id").eq("id", f.dish.id).single();
        if (readError) throw new Error(readError.message);
        const { data, error } = await f.admin.from("menu_items").insert({ restaurant_id: r, menu_id: dishRow.menu_id,
          name: `${MARK} S23 ${name}`, price: 5, is_addon: true, available: true, modifiers: [], discount_pct: 0 }).select("id, menu_id").single();
        if (error) throw new Error(error.message);
        made.push(data.id);
        return data;
      };
      const links = async (f, id) => {
        const { data, error } = await f.admin.from("item_addons").select("addon_id").eq("product_id", id);
        if (error) throw new Error(error.message);
        return data.map(l => l.addon_id).sort();
      };
      const cleanup = f => async () => {
        const { error } = await f.admin.from("menu_items").delete().in("id", made.splice(0));
        if (error) throw new Error(error.message);
        await f.admin.from("menu_items").delete().eq("restaurant_id", r).like("name", `${MARK} S23 %`);
      };
      const dishWith = async (f, addon) => {
        const { data, error } = await f.admin.from("menu_items").insert({ restaurant_id: r, menu_id: addon.menu_id,
          name: `${MARK} S23 dish`, price: 12, is_addon: false, available: true, modifiers: [], discount_pct: 0 }).select("id").single();
        if (error) throw new Error(error.message);
        made.push(data.id);
        const { error: linkError } = await f.admin.from("item_addons").insert({ product_id: data.id, addon_id: addon.id, sort_order: 0 });
        if (linkError) throw new Error(linkError.message);
        return data.id;
      };
      return [
        { name: "PATCH /api/products (S23: a new dish and its extra save together)", as: "manager", method: "PATCH", path: "/api/products",
          arrange: async f => { f.s23 = { extra: await extra(f, "extra") }; return cleanup(f); },
          body: f => ({ menuId: f.s23.extra.menu_id, categoryId: null, changes: { name: `${MARK} S23 new dish`, price: 12 }, addonIds: [f.s23.extra.id] }),
          expect: [200],
          check: async (data, f) => {
            if (!data.id) return "no dish id came back";
            made.push(data.id);
            const { data: dish } = await f.admin.from("menu_items").select("name, price, menu_id").eq("id", data.id).single();
            if (dish?.name !== `${MARK} S23 new dish` || Number(dish.price) !== 12) return `the dish saved as ${JSON.stringify(dish)}`;
            const got = await links(f, data.id);
            return (got.length === 1 && got[0] === f.s23.extra.id) || `extras ${JSON.stringify(got)}`;
          } },
        { name: "PATCH /api/products (S23: an edit replaces the extras in the same write)", as: "manager", method: "PATCH", path: "/api/products",
          arrange: async f => {
            const first = await extra(f, "first"), second = await extra(f, "second");
            f.s23 = { first, second, dish: await dishWith(f, first) };
            return cleanup(f);
          },
          body: f => ({ id: f.s23.dish, changes: { description: `${MARK} S23 described` }, addonIds: [f.s23.second.id] }), expect: [200],
          check: async (_data, f) => {
            const { data: dish } = await f.admin.from("menu_items").select("description").eq("id", f.s23.dish).single();
            const got = await links(f, f.s23.dish);
            return (dish?.description === `${MARK} S23 described` && got.length === 1 && got[0] === f.s23.second.id)
              || `description ${dish?.description}, extras ${JSON.stringify(got)}`;
          } },
        { name: "PATCH /api/products (S23: a refused extra leaves the dish as it was)", as: "manager", method: "PATCH", path: "/api/products",
          arrange: async f => {
            const first = await extra(f, "kept");
            f.s23 = { first, dish: await dishWith(f, first) };
            return cleanup(f);
          },
          // The demo dish itself is not an extra: the write must refuse it and change nothing.
          body: f => ({ id: f.s23.dish, changes: { description: `${MARK} S23 must not save` }, addonIds: [f.dish.id] }), expect: [503],
          effect: async f => {
            const { data: dish } = await f.admin.from("menu_items").select("description").eq("id", f.s23.dish).single();
            const got = await links(f, f.s23.dish);
            return (dish?.description !== `${MARK} S23 must not save` && got.length === 1 && got[0] === f.s23.first.id)
              || `a refused write changed the dish: description ${dish?.description}, extras ${JSON.stringify(got)}`;
          } },
      ];
    })(),
    { name: "POST /api/products (a recount requires the opening count)", as: "manager", method: "POST",
      path: "/api/products", body: { id: dish.id, stock: 5 }, expect: [400] },
  ];
}

export function couponValidationCases(fx) {
  const { restaurant } = fx;
  const r = restaurant.id;
  return [
    { name: "POST /api/coupons/validate", as: "diner", method: "POST", path: "/api/coupons/validate",
      body: { restaurantId: r, code: "API-001", subtotal: 100 }, expect: [200, 400, 404] },
  ];
}

export function menuSettingsCases(fx) {
  const { dish } = fx;
  return [
    { name: "POST /api/settings", as: "manager", method: "POST", path: "/api/settings",
      body: { accepting_orders: true }, expect: [200] },
    // Switching the service charge off takes it off an open bill nobody has
    // started paying. The live demo owed MX$4.40 for a MX$4.00 salad after the
    // owner had switched it off: the charge was stored when it was ordered.
    { name: "POST /api/settings (service off takes it off an open bill)", as: "owner", method: "POST",
      path: "/api/settings", arrange: f => f.withServicedOrder(), body: { service_enabled: false },
      expect: [200],
      effect: async f => {
        const { data } = await f.admin
          .from("orders").select("service_fee, total").eq("id", f.servicedOrder.id).maybeSingle();
        return Number(data?.service_fee) === 0 && Number(data?.total) === 4
          ? true
          : `the open bill still owes ${data?.total} with a service charge of ${data?.service_fee}`;
      } },
    { name: "POST /api/coupons (create)", as: "manager", method: "POST", path: "/api/coupons",
      body: { code: "API-001", kind: "percent", value: 10 }, expect: [200] },
    { name: "PATCH /api/coupons (switch off)", as: "manager", method: "PATCH", path: "/api/coupons",
      body: async f => ({ id: await couponId(f), active: false }), expect: [200] },
    { name: "DELETE /api/coupons", as: "manager", method: "DELETE", path: "/api/coupons",
      body: async f => ({ id: await couponId(f) }), expect: [200] },
    { name: "POST /api/dietary-tags (create)", as: "manager", method: "POST", path: "/api/dietary-tags",
      body: { label: `${MARK} diet`, labelEn: "apicheck diet", emoji: "🍬" },
      expect: [200], check: d => Boolean(d.id) || "returned no tag id" },
    { name: "PATCH /api/dietary-tags (rename)", as: "manager", method: "PATCH", path: "/api/dietary-tags",
      body: async f => ({ id: await dietaryTagId(f), label: `${MARK} diet`, emoji: "🍭" }),
      expect: [200] },
    { name: "DELETE /api/dietary-tags", as: "manager", method: "DELETE", path: "/api/dietary-tags",
      body: async f => ({ id: await dietaryTagId(f) }), expect: [200] },
    { name: "POST /api/icon-groups (create)", as: "manager", method: "POST", path: "/api/icon-groups",
      body: { name: `${MARK} icons`, variant: "addon", icons: [{ emoji: "🌮" }, { emoji: "🌶️" }] },
      expect: [200], check: d => Boolean(d.id) || "returned no icon group id" },
    { name: "PATCH /api/icon-groups (rename)", as: "manager", method: "PATCH", path: "/api/icon-groups",
      body: async f => ({ id: await iconGroupId(f), name: `${MARK} icons`, icons: [{ emoji: "🧄" }] }),
      expect: [200] },
    { name: "DELETE /api/icon-groups", as: "manager", method: "DELETE", path: "/api/icon-groups",
      body: async f => ({ id: await iconGroupId(f) }), expect: [200] },
    { name: "POST /api/promotions (create)", as: "manager", method: "POST", path: "/api/promotions",
      body: { kind: "bogo", name: `${MARK} 2x1`, emoji: "🎁", buyQty: 2, payQty: 1,
              items: [{ itemId: dish.id, qty: 1 }] }, expect: [200] },
    // A tier the pricing loop cannot finish: 1e-20 units passed "positive",
    // and pricing one unit then spun for ever and froze the server.
    { name: "POST /api/promotions (a tier of a fraction of a unit)", as: "manager", method: "POST", path: "/api/promotions",
      body: { kind: "tiered", name: `${MARK} tier`, emoji: "🎁", tiers: [{ qty: 1e-20, price: 0 }],
              items: [{ itemId: dish.id, qty: 1 }] },
      expect: [400], expectError: /cantidad entera|whole quantity/i },
    // A blank price arrived as 0 and saved "2 for MX$0": the dishes went free.
    { name: "POST /api/promotions (a tier with no price)", as: "manager", method: "POST", path: "/api/promotions",
      body: { kind: "tiered", name: `${MARK} free tier`, emoji: "🎁", tiers: [{ qty: 2, price: 0 }],
              items: [{ itemId: dish.id, qty: 1 }] },
      expect: [400], expectError: /y un precio|and a price/i },
    { name: "POST /api/legal/accept", as: "owner", method: "POST", path: "/api/legal/accept",
      body: {}, expect: [200] },
    { name: "GET  /api/connect/status", as: "owner", method: "GET", path: "/api/connect/status",
      expect: [200] },
  ];
}

export function promotionCleanupCases() {
  return [
    // ── promotions: the rest of their life ───────────────────────────────
    { name: "PATCH /api/promotions (switch off)", as: "manager", method: "PATCH", path: "/api/promotions",
      body: async f => ({ id: await promoId(f), active: false }), expect: [200] },
    { name: "DELETE /api/promotions", as: "manager", method: "DELETE", path: "/api/promotions",
      body: async f => ({ id: await promoId(f) }), expect: [200] },
  ];
}
