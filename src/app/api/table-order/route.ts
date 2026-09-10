import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingStaff } from "@/lib/api-guard";
import { TAKES_TABLE_ORDERS } from "@/lib/membership";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { capNote } from "@/lib/notes";
import { priceCart } from "@/lib/pricing";
import { referencedItemIds, verifyCart, type VerifiableItem } from "@/lib/verify-cart";
import { fetchPromotions } from "@/lib/promotions-data";
import { toCartPromos } from "@/lib/promotions";
import { DEFAULT_TIME_ZONE, openMenuIds, type MenuOpenState } from "@/lib/open-menus";
import { raiseStockNotifications, releaseStock, reserveStock } from "@/lib/stock-service";
import { openSession } from "@/lib/table-session";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { orderCode, type OrderLineItem } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/table-order — a waiter takes an order at a table.
 *
 * The oldest act in the trade, and the one the app could not do: somebody walks
 * to a table and writes down what the people sitting at it want. Everything
 * around it already existed — the bill, the split, the discount that needs a
 * manager, taking cash at the table — and none of it was reachable, because the
 * order had to start on a diner's phone.
 *
 * Unpaid on purpose. This is a table that settles at the end, which is what
 * `allow_pay_later` has always meant; the money is asked for when they ask for
 * the bill, by whoever is standing there. Nothing here charges anything.
 *
 * The table has to exist. A waiter picks it; they never invent one, so an order
 * can always be found by the label the restaurant already uses for that table.
 */
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  if (!TAKES_TABLE_ORDERS(actor.role)) return await apiError("apiErr.forbidden", 403);

  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  const blocked = await planBlocks(actor.restaurantId, "waiterService");
  if (blocked) return blocked;

  const body = (await req.json().catch(() => ({}))) as {
    tableId?: string;
    items?: OrderLineItem[];
    note?: string;
  };
  const items = Array.isArray(body.items) ? body.items : [];
  if (!body.tableId || items.length === 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();

  // The table must be one of this restaurant's. An id from anywhere else finds
  // nothing, and a waiter cannot seat a party at somebody else's table.
  const { data: table } = await db
    .from("restaurant_tables")
    .select("id, label")
    .eq("id", body.tableId)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  if (!table) return await apiError("apiErr.tableNotFound", 404);

  // Read with the secret key: the same reason the till does. `public read
  // available menu` gives a browser only what is available, and a waiter needs
  // to price from the row rather than from what a screen last showed.
  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, currency, service_pct, service_enabled, tax_pct, timezone, low_stock_threshold")
    .eq("id", actor.restaurantId)
    .maybeSingle();
  if (!restaurant) return await apiError("apiErr.restaurantNotFound", 404);

  const [menusRes, catsRes] = await Promise.all([
    db.from("menus").select("id, active, schedule").eq("restaurant_id", actor.restaurantId),
    db.from("categories").select("id, menu_id").eq("restaurant_id", actor.restaurantId),
  ]);

  // Only what the restaurant is actually serving. A waiter should no more be
  // able to write down a dish from a menu that closed at lunch than a diner can
  // order one — the same decision, from the same function.
  const { ids: openIds, closedNow } = openMenuIds(
    (menusRes.data as MenuOpenState[] | null) ?? [],
    (restaurant.timezone as string | null) ?? DEFAULT_TIME_ZONE,
  );
  if (closedNow) return await apiError("apiErr.closedNow", 409);

  const menuOfCategory = new Map(
    ((catsRes.data as { id: string; menu_id: string | null }[] | null) ?? []).map(c => [c.id, c.menu_id]),
  );
  /** Extras have no category of their own; they ride with their product. */
  const isOnOpenMenu = (categoryId: string | null): boolean => {
    if (!categoryId) return true;
    const menuId = menuOfCategory.get(categoryId);
    return !menuId || openIds.includes(menuId);
  };

  const promotions = await fetchPromotions(db, actor.restaurantId);
  const referencedIds = referencedItemIds(items, promotions);
  const { data: dbItems } = await db
    .from("menu_items")
    .select("id, name, price, emoji, available, discount_pct, modifiers, category_id, skips_kitchen, menu_id")
    .in("id", referencedIds)
    .eq("restaurant_id", actor.restaurantId);
  if (!dbItems) return await apiError("apiErr.verifyItems", 400);

  const result = verifyCart({
    items,
    promotions,
    dbItems: dbItems as VerifiableItem[],
    isOnOpenMenu,
  });
  if (!result.ok) {
    return NextResponse.json({ rejection: result.rejection }, { status: 400 });
  }
  const verified = result.lines;

  // Prices come from the rows, never from the request — the same rule the
  // diner's checkout and the till both follow. No tip here: the tip is decided
  // when somebody pays, and nobody is paying yet.
  const pricing = priceCart({
    items: verified,
    servicePct: Number(restaurant.service_pct) || 0,
    serviceEnabled: Boolean(restaurant.service_enabled),
    promos: toCartPromos(promotions),
  });

  const reservation = await reserveStock(
    actor.restaurantId,
    verified,
    Number(restaurant.low_stock_threshold) || 0,
  );
  if (!reservation.ok) {
    return NextResponse.json({ short: reservation.short, code: "outOfStock" }, { status: 409 });
  }

  // Joins the sitting already open at this table, or opens one. Two waiters
  // adding to the same table land on the same bill, which is what the diners
  // sitting there would expect.
  // Named, because opening the bill is what makes it the waiter's to settle:
  // the diners can watch it and add to it, and pay the person in front of them
  // rather than a card field on their phone.
  const sessionId = await openSession(actor.restaurantId, table.id as string, actor.email);

  const { data: order, error } = await db
    .from("orders")
    .insert({
      restaurant_id: actor.restaurantId,
      table_id: table.id,
      table_label: table.label,
      session_id: sessionId,
      // Straight to the pass, and owing. The kitchen starts cooking; the money
      // is asked for at the end.
      status: "received",
      paid: false,
      pay_method: null,
      subtotal: pricing.subtotal,
      service_fee: pricing.serviceFee,
      tip: 0,
      tax_pct: Number(restaurant.tax_pct) || 0,
      discount: pricing.discount,
      // Nothing reaches Stripe until somebody settles, so there is no
      // application fee to take here.
      platform_fee: 0,
      promo_detail:
        pricing.discount > 0
          ? { item: pricing.itemDiscount, promos: pricing.promoDiscount, coupon: 0 }
          : null,
      total: pricing.total,
      currency: restaurant.currency,
      items: verified,
      note: capNote(body.note) ?? null,
    })
    .select("id")
    .single();

  if (error || !order) {
    // The food was never ordered, so it goes back on the shelf.
    await releaseStock(actor.restaurantId, verified);
    return await apiError("apiErr.orderCreate", 500);
  }

  await raiseStockNotifications(actor.restaurantId, reservation.low);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "order",
    action: "created",
    detail: logDetail({
      code: orderCode(order.id as string),
      table: String(table.label),
      amount: pricing.total.toFixed(2),
    }),
  });

  return NextResponse.json({
    orderId: order.id,
    code: orderCode(order.id as string),
    total: pricing.total,
    table: table.label,
  });
}
