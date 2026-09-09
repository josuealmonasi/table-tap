import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingStaff } from "@/lib/api-guard";
import { TAKES_COUNTER_ORDERS } from "@/lib/membership";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { capName, capNote } from "@/lib/notes";
import { priceCart } from "@/lib/pricing";
import { referencedItemIds, verifyCart, type VerifiableItem } from "@/lib/verify-cart";
import { fetchPromotions } from "@/lib/promotions-data";
import { toCartPromos } from "@/lib/promotions";
import { DEFAULT_TIME_ZONE, openMenuIds, type MenuOpenState } from "@/lib/open-menus";
import { raiseStockNotifications, releaseStock, reserveStock } from "@/lib/stock-service";
import { recordPayment } from "@/lib/payments";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { orderCode } from "@/lib/types";
import { buildReceipt } from "@/lib/receipt";
import { mailConfigured, sendMail } from "@/lib/mail";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { messagesFor, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import type { OrderLineItem } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/pos/order — a cashier rings a sale at the counter.
 *
 * The money is already in the drawer by the time this is called: the customer
 * paid cash, or a card on the restaurant's own terminal. Nothing here talks to
 * Stripe, which is why the order arrives paid and on the pass in one step
 * rather than waiting for anyone to confirm it.
 *
 * The order of work is what keeps it safe:
 *
 *   1. Price it from the DATABASE. The till sends what was ordered, never what
 *      it costs — same `verifyCart` and `priceCart` the diner's own cart runs,
 *      so a dish cannot be one price at the counter and another on a phone.
 *   2. Take the stock. If a portion went while the cashier was ringing it up
 *      this refuses and names what is short, BEFORE any payment is recorded —
 *      the alternative is selling food the kitchen cannot make.
 *   3. Then write the order, the payment and the log.
 *
 * `pos_ref` makes the whole thing idempotent. A request that times out and is
 * sent again lands on a unique index rather than charging twice and putting a
 * second ticket on the pass.
 */
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  if (!TAKES_COUNTER_ORDERS(actor.role)) return await apiError("apiErr.forbidden", 403);

  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const blocked = await planBlocks(actor.restaurantId, "pos");
  if (blocked) return blocked;

  const body = (await req.json().catch(() => ({}))) as {
    posRef?: string;
    items?: OrderLineItem[];
    method?: "cash" | "card";
    customerName?: string;
    email?: string;
    note?: string;
    tipPct?: number;
    tipAmount?: number;
  };
  const { posRef, items, method } = body;

  if (!posRef || !Array.isArray(items) || items.length === 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (method !== "cash" && method !== "card") {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();

  // The same sale, sent twice. Answer with the ticket that already exists
  // rather than ringing it again.
  const { data: already } = await db
    .from("orders")
    .select("id, total")
    .eq("pos_ref", posRef)
    .maybeSingle();
  if (already) {
    return NextResponse.json({
      orderId: already.id,
      code: orderCode(already.id as string),
      total: Number(already.total),
      repeat: true,
    });
  }

  // Read with the secret key, not the staff session. `restaurants` grants a
  // browser only the columns a diner's menu needs, so a cashier's own client
  // cannot see `service_pct` — and a till that cannot read the service charge
  // cannot price a sale. Every query below is scoped to the actor's own
  // restaurant, which is what makes that safe.
  const supabase = db;
  const [{ data: restaurant }, menusRes, catsRes] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id, name, currency, tax_pct, service_pct, service_enabled, timezone, low_stock_threshold, low_stock_alerts_enabled")
      .eq("id", actor.restaurantId)
      .single(),
    supabase
      .from("menus")
      .select("id, active, schedule")
      .eq("restaurant_id", actor.restaurantId),
    supabase.from("categories").select("id, menu_id").eq("restaurant_id", actor.restaurantId),
  ]);
  if (!restaurant) return await apiError("apiErr.forbidden", 403);

  // Only what the restaurant is actually serving right now: a cashier should
  // not be able to ring a dish from a menu that closed at lunch. The same
  // decision the diner's own menu makes, from the same function.
  const { ids: openIds, closedNow } = openMenuIds(
    (menusRes.data as MenuOpenState[] | null) ?? [],
    (restaurant.timezone as string | null) ?? DEFAULT_TIME_ZONE,
  );
  if (closedNow) return await apiError("apiErr.closedNow", 409);

  const menuOfCategory = new Map(
    ((catsRes.data as { id: string; menu_id: string | null }[] | null) ?? []).map(c => [
      c.id,
      c.menu_id,
    ]),
  );
  /** Extras have no category of their own; they ride with their product. */
  const onOpenMenu = (categoryId: string | null): boolean => {
    if (!categoryId) return true;
    const menuId = menuOfCategory.get(categoryId);
    return !menuId || openIds.includes(menuId);
  };

  // Products AND extras AND every combo component — the same list checkout
  // fetches, from the same function, because verifyCart prices only what it is
  // handed and a missing extra reads to it as one that has vanished.
  const promotions = await fetchPromotions(supabase, actor.restaurantId);
  const referencedIds = referencedItemIds(items, promotions);
  const { data: dbItems } = await supabase
    .from("menu_items")
    .select("id, name, price, emoji, available, discount_pct, modifiers, category_id")
    .in("id", referencedIds)
    .eq("restaurant_id", actor.restaurantId);
  if (!dbItems) return await apiError("apiErr.verifyItems", 400);

  const result = verifyCart({
    items,
    promotions,
    dbItems: dbItems as VerifiableItem[],
    isOnOpenMenu: onOpenMenu,
  });
  if (!result.ok) {
    const r = result.rejection;
    if (r.kind === "unavailable") {
      return await apiError(r.name ? "apiErr.itemGone" : "apiErr.itemGoneUnnamed", 400, {
        name: r.name ?? "",
      });
    }
    if (r.kind === "missingModifiers") {
      return await apiError("apiErr.chooseFirst", 400, {
        options: r.unanswered.join(", "),
        name: r.forName,
      });
    }
    return await apiError("apiErr.verifyItems", 400);
  }
  const verified = result.lines;

  // No coupon: a code is the diner's to spend, not the till's to apply. The
  // tip and the service charge come from the same `priceCart` the diner's own
  // cart runs — two ways to price the same sale is the bug this shares code to
  // avoid, and an exact tip is capped there rather than trusted from here.
  const pricing = priceCart({
    items: verified,
    servicePct: restaurant.service_pct,
    serviceEnabled: restaurant.service_enabled,
    tipPct: Number(body.tipPct) || 0,
    tipAmount: typeof body.tipAmount === "number" ? body.tipAmount : undefined,
    coupon: null,
    promos: toCartPromos(promotions),
  });

  const reservation = await reserveStock(
    actor.restaurantId,
    verified,
    Number(restaurant.low_stock_threshold) || 0,
  );
  if (!reservation.ok) {
    // Nothing has been written and no payment recorded: the cashier can put a
    // portion back and ring it again, which is what a counter actually does.
    return NextResponse.json(
      { short: reservation.short, code: "outOfStock" },
      { status: 409 },
    );
  }

  const { data: order, error } = await db
    .from("orders")
    .insert({
      restaurant_id: actor.restaurantId,
      table_id: null,
      table_label: null,
      session_id: null,
      // Straight to the pass. There is nothing to wait for: the money is in
      // the drawer before this request is made.
      status: "received",
      paid: true,
      pay_method: method,
      pos_ref: posRef,
      subtotal: pricing.subtotal,
      service_fee: pricing.serviceFee,
      tip: pricing.tip,
      tax_pct: Number(restaurant.tax_pct) || 0,
      discount: pricing.discount,
      // Nothing of this reaches Stripe, so there is no application fee to take.
      // The subscription is what pays for the till.
      platform_fee: 0,
      promo_detail:
        pricing.discount > 0
          ? { item: pricing.itemDiscount, promos: pricing.promoDiscount, coupon: 0 }
          : null,
      total: pricing.total,
      currency: restaurant.currency,
      items: verified,
      note: capNote(body.note) ?? null,
      // How they get called when it is ready. Optional, and the only personal
      // thing a counter order keeps.
      customer_name: capName(body.customerName) ?? null,
    })
    .select("id")
    .single();

  if (error || !order) {
    // Two requests carrying the same `pos_ref` can both pass the check above
    // and race to the unique index. The loser must NOT hand back stock: the
    // winner legitimately took it, and releasing it here would put a portion
    // back on the shelf that has already been sold. Answer with the ticket
    // that exists, which is what the caller was asking for anyway.
    if (error?.code === "23505") {
      const { data: won } = await db
        .from("orders")
        .select("id, total")
        .eq("pos_ref", posRef)
        .maybeSingle();
      if (won) {
        return NextResponse.json({
          orderId: won.id,
          code: orderCode(won.id as string),
          total: Number(won.total),
          repeat: true,
        });
      }
    }
    await releaseStock(actor.restaurantId, verified);
    return await apiError("apiErr.orderCreate", 500);
  }

  await recordPayment({
    restaurantId: actor.restaurantId,
    orderId: order.id as string,
    amount: pricing.total,
    method,
    actorEmail: actor.email,
  });

  if (restaurant.low_stock_alerts_enabled) {
    await raiseStockNotifications(actor.restaurantId, reservation.low);
  }

  // Logged as money taken, not as an order created, because that is what it
  // is — and because the drawer and the ledger are reconciled against each
  // other. `pnpm money` compares `bill/paid` rows with the payments they
  // should match; filing a counter sale anywhere else made the two records of
  // the same cash disagree by exactly the counter's takings.
  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: "paid",
    detail: logDetail({
      code: orderCode(order.id as string),
      amount: pricing.total.toFixed(2),
      method,
    }),
  });

  // "Do you want your receipt sent, or printed?" — whichever they answer, this
  // handles it. The address is used for this one message and never written
  // down: an order row is kept for years as the restaurant's accounting
  // record, and an address stored beside one would outlive its purpose by
  // about that much. `receipt_sent_at` is all that stays, which answers "did
  // this get a receipt?" without keeping anybody's address. The privacy notice
  // makes that promise; this is the code that keeps it.
  let receipt: "sent" | "failed" | null = null;
  /** The ticket to print, when nobody asked for it by email. */
  let receiptHtml: string | null = null;
  const address = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const wantsMail = Boolean(address) && isValidEmail(address) && mailConfigured();

  {
    const locale = await getLocale();
    const messages = messagesFor(locale);
    const built = buildReceipt(
      [
        {
          id: order.id as string,
          items: verified,
          subtotal: pricing.subtotal,
          service_fee: pricing.serviceFee,
          tip: pricing.tip,
          discount: pricing.discount,
          total: pricing.total,
          currency: restaurant.currency as string,
          created_at: new Date().toISOString(),
          pay_method: method,
        },
      ],
      {
        name: (restaurant as { name?: string }).name ?? "TableTap",
        timeZone: (restaurant.timezone as string | null) ?? DEFAULT_TIME_ZONE,
        locale: locale === "es" ? "es-MX" : "en-US",
      },
      (key, vars) => translate(messages, key, vars),
    );
    if (wantsMail) {
      const mail = await sendMail({
        to: address,
        subject: built.subject,
        text: built.text,
        html: built.html,
        fromName: (restaurant as { name?: string }).name ?? "TableTap",
      });
      receipt = mail.sent ? "sent" : "failed";
      // Asked for by email and it did not go: hand back the ticket so the
      // cashier can print it. Telling them to print without giving them
      // anything to print is not an answer.
      if (!mail.sent) receiptHtml = built.html;
      if (mail.sent) {
        await db
          .from("orders")
          .update({ receipt_sent_at: new Date().toISOString() })
          .eq("id", order.id);
      }
    } else {
      // Nobody gave an address, so it is printed. The same document either
      // way — one goes in an email, one goes through the printer.
      receiptHtml = built.html;
    }
  }

  return NextResponse.json({
    orderId: order.id,
    code: orderCode(order.id as string),
    total: pricing.total,
    receipt,
    receiptHtml,
  });
}
