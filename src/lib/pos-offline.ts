import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import type { Actor } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { capName, capNote } from "@/lib/notes";
import { priceCart } from "@/lib/pricing";
import { promotionsOnSale } from "@/lib/promotions-on-sale";
import { toCartPromos } from "@/lib/promotions";
import { cartReferences, verifyCart, type VerifiableItem } from "@/lib/verify-cart";
import { stockDemand, toDemandPayload } from "@/lib/stock";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { orderCode, type OrderLineItem } from "@/lib/types";
import { existingTicket, terminalRef, type PosSaleBody } from "@/lib/pos-sale";
import { offlineCharge, offlineDrift, offlineLines } from "@/lib/offline-sale";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A sale the till rang without a connection, sent now that it has one.
 *
 * It already happened: the customer paid and left with the food. So nothing
 * here refuses it for what the menu says today — a dish sold out since, a
 * menu closed since, a price changed since. It is recorded at the time it
 * happened, for what was collected, finished (the kitchen worked from the
 * ticket at the time), and its stock is taken down to nought at most. Today's
 * menu prices it only to show a manager the difference.
 *
 * Its reference is its id, so the code on the ticket the till printed offline
 * is the code the sale has, and a sale sent twice is rung once.
 */
export async function ringOffline(actor: Actor, body: PosSaleBody & { offline?: unknown }): Promise<NextResponse> {
  const charge = offlineCharge(body.offline);
  if (!charge) return await apiError("apiErr.offlineSale", 400);
  if (body.method !== "cash" && body.method !== "card") return await apiError("apiErr.offlineMethod", 400);
  const posRef = typeof body.posRef === "string" && UUID.test(body.posRef) ? body.posRef : null;
  if (!posRef || !Array.isArray(body.items) || body.items.length === 0) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  const already = await existingTicket(db, posRef, actor.restaurantId);
  if (already) return already;

  const { data: restaurant } = await db.from("restaurants")
    .select("currency, tax_pct, service_pct, service_enabled").eq("id", actor.restaurantId).single();
  if (!restaurant) return await apiError("apiErr.forbidden", 403);

  // Today's menu, with "sold out" and "closed" waived: the sale happened.
  const promotions = await promotionsOnSale(db, actor.restaurantId);
  const refs = cartReferences(body.items, promotions);
  let lines: OrderLineItem[] = offlineLines(body.items);
  let serverTotal: number | null = null;
  if (refs.ok) {
    const { data: dbItems } = await db.from("menu_items")
      .select("id, name, price, emoji, available, discount_pct, modifiers, category_id, skips_kitchen, categories(station)")
      .in("id", refs.ids).eq("restaurant_id", actor.restaurantId);
    const verified = dbItems
      ? verifyCart({
          items: body.items, promotions,
          dbItems: (dbItems as VerifiableItem[]).map(d => ({ ...d, available: true })),
          isOnOpenMenu: () => true,
        })
      : null;
    if (verified?.ok) {
      lines = verified.lines;
      serverTotal = priceCart({
        items: verified.lines, servicePct: restaurant.service_pct, serviceEnabled: restaurant.service_enabled,
        tipPct: Number(body.tipPct) || 0, tipAmount: typeof body.tipAmount === "number" ? body.tipAmount : undefined,
        coupon: null, promos: toCartPromos(promotions),
      }).total;
    }
  }
  if (lines.length === 0) return await apiError("apiErr.invalidRequest", 400);

  const { data: ticket, error } = await db.rpc("ring_pos_sale", {
    p_restaurant: actor.restaurantId, p_ref: posRef, p_method: body.method, p_actor: actor.email,
    p_status: "completed", p_at: charge.at, p_threshold: 0, p_inventory: false,
    p_terminal: body.method === "card" ? terminalRef(body.terminalRef) : null,
    p_demand: toDemandPayload(stockDemand(lines)),
    p_order: {
      subtotal: charge.subtotal, service_fee: charge.serviceFee, tip: charge.tip,
      discount: charge.discount, total: charge.total, tax_pct: Number(restaurant.tax_pct) || 0,
      currency: restaurant.currency, items: lines, note: capNote(body.note) ?? null,
      customer_name: capName(body.customerName) ?? null, offline_drift: offlineDrift(charge.total, serverTotal),
    },
  });
  // One transaction rings it — the order, the money and the stock — so two
  // sends racing meet on its lock and the second gets the first one's ticket.
  // An error may be a lost response after commit: deleting would orphan its
  // money, so the device simply sends again.
  if (error || !ticket) return await apiError("apiErr.orderCreate", 503);
  if (ticket.outcome !== "settled") return await apiError("apiErr.posUnsettled", 409);
  if (ticket.repeat) return NextResponse.json({ ...ticket, code: orderCode(ticket.orderId) });

  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "bill", action: "paid",
    detail: logDetail({ code: orderCode(posRef), amount: charge.total.toFixed(2), method: body.method }),
  });
  return NextResponse.json({ orderId: posRef, code: orderCode(posRef), total: charge.total, offline: true, settled: true });
}
