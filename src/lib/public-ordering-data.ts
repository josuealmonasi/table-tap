import { publicMenuRows, publicMenuShell } from "@/lib/public-menu-cache";
import { getPlan } from "@/lib/plan-server";
import { can } from "@/lib/plan";
import { DEFAULT_TIME_ZONE, openMenuIds } from "@/lib/open-menus";
import { buildCombos, toCartPromos } from "@/lib/promotions";
import { mailConfigured } from "@/lib/mail";
import { issueVisitPass } from "@/lib/loyalty/pass";
import type { OrderingData } from "@/lib/ordering-data";

/** Derive every time-sensitive answer anew, even on a warm restaurant cache. */
export async function loadPublicOrderingData(restaurantId: string): Promise<OrderingData> {
  const [contents, shell, plan] = await Promise.all([publicMenuRows(restaurantId), publicMenuShell(restaurantId), getPlan(restaurantId)]);
  const raw = { ...contents, ...shell };
  const { ids, closedNow } = openMenuIds(raw.menus, raw.restaurant?.timezone ?? DEFAULT_TIME_ZONE, {
    schedules: plan ? can(plan.limits, "menuSchedules") : false,
  });
  const categories = raw.categories.filter(c => ids.includes(c.menu_id!));
  const allItems = raw.items.filter(i => ids.includes(i.menu_id!));
  const items = allItems.filter(i => !i.is_addon);
  const extras = allItems.filter(i => i.is_addon);
  const extrasByProduct: OrderingData["extrasByProduct"] = {};
  const productIds = new Set(items.map(i => i.id));
  for (const link of raw.links) {
    if (productIds.has(link.product_id)) (extrasByProduct[link.product_id] ??= []).push(link.addon_id);
  }
  // Promotions currently have an active switch, no dates. Keep their entitlement
  // and card construction here so a clock-dependent offer never enters the cache.
  const promotions = plan && can(plan.limits, "promotions") ? raw.promotions : [];
  const ratings: OrderingData["ratings"] = {};
  for (const row of raw.stats) ratings[row.item_id] = { avg: Number(row.avg_rating), count: Number(row.rating_count) };
  // Copy before applying plan flags: request-specific results must not mutate raw rows.
  const restaurant = raw.restaurant ? { ...raw.restaurant } : null;
  if (restaurant) {
    delete restaurant.timezone;
    if (!restaurant.service_enabled) restaurant.service_pct = 0;
    restaurant.cards_enabled = raw.cardsEnabled;
    if (restaurant.allow_pay_later) restaurant.allow_pay_later = plan ? can(plan.limits, "deferredPayment") : false;
    restaurant.coupons_enabled = plan ? can(plan.limits, "coupons") : false;
  }
  const program = plan && can(plan.limits, "loyalty") && raw.program?.active && raw.program.reward ? raw.program : null;
  return {
    restaurant, categories, items, extras, extrasByProduct, ratings, closedNow,
    combos: buildCombos(promotions, new Map(items.map(i => [i.id, i]))), promos: toCartPromos(promotions),
    receipts: mailConfigured(), dietaryTags: raw.dietaryTags,
    orderAtRegister: plan ? !can(plan.limits, "onlineOrdering") : false,
    loyalty: restaurant && program ? {
      restaurantId, restaurantName: restaurant.name, goal: program.goal, reward: program.reward, steps: program.steps,
      pass: issueVisitPass(restaurantId, "counter"),
    } : null,
  };
}
