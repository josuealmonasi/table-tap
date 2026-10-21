import { expect, it } from "vitest";
import { verifyCart, type VerifiableItem } from "@/lib/verify-cart";
import { sameOfflinePrice } from "@/lib/offline-pricing";
import { priceCart } from "@/lib/pricing";
import type { PromotionWithItems } from "@/lib/promotions";
import type { OrderLineItem } from "@/lib/types";

const dish: OrderLineItem = { itemId: "dish", name: "Dish", emoji: "", price: 50, qty: 1, mods: {} };
const combo: OrderLineItem = { itemId: "meal", comboId: "meal", name: "Meal", emoji: "", price: 90, qty: 1, mods: {}, components: [{ itemId: "dish", name: "Dish", emoji: "", qty: 2 }] };
const promotion: PromotionWithItems = { id: "meal", restaurant_id: "r", kind: "combo", name: "Meal", emoji: "", description: null,
  combo_price: 90, buy_qty: null, pay_qty: null, tiers: null, active: true, sort_order: 0, items: [{ item_id: "dish", qty: 2 }] };
const dbItem: VerifiableItem = { id: "dish", name: "Dish", emoji: "", price: 50, available: true, discount_pct: 0, modifiers: null, category_id: null };

it.each([[dish, combo], [combo, dish]])("accepts an unchanged mixed cart in submission order %#", (...items) => {
  const verified = verifyCart({ items, dbItems: [dbItem], promotions: [promotion], isOnOpenMenu: () => true });
  expect(verified.ok).toBe(true);
  if (!verified.ok) throw new Error("Cart did not verify");
  const price = priceCart({ items: verified.lines, servicePct: 0, serviceEnabled: false, tipPct: 0, coupon: null, promos: [] });
  expect(price.total).toBe(140);
  expect(sameOfflinePrice({ ...price, at: "2026-10-20T12:00:00Z" }, items, { price, lines: verified.lines })).toBe(true);
});
it("preserves duplicate counts even when different lines have equal prices", () => {
  const other = { ...dish, itemId: "other" };
  const price = { subtotal: 150, serviceFee: 0, tip: 0, discount: 0, total: 150 };
  const current = { price: priceCart({ items: [dish, other, other], servicePct: 0, serviceEnabled: false }), lines: [dish, other, other] };
  expect(sameOfflinePrice({ ...price, at: "2026-10-20T12:00:00Z" }, [dish, dish, other], current)).toBe(false);
  expect(sameOfflinePrice({ ...price, at: "2026-10-20T12:00:00Z" }, [other, dish, other], current)).toBe(true);
});
