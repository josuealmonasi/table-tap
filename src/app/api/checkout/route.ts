import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderLineItem } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/checkout
// Body: { restaurantId, tableId, tableLabel, items: OrderLineItem[], note }
// Creates a pending order, then a Stripe Checkout Session, and returns its URL.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { restaurantId, tableId, tableLabel, items, note } = body as {
      restaurantId: string;
      tableId: string | null;
      tableLabel: string | null;
      items: OrderLineItem[];
      note?: string;
    };

    if (!restaurantId || !items?.length) {
      return NextResponse.json({ error: "Missing order data" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Re-fetch the restaurant to get the authoritative service % and currency.
    const { data: restaurant, error: rErr } = await supabase
      .from("restaurants")
      .select("id, currency, service_pct")
      .eq("id", restaurantId)
      .single();

    if (rErr || !restaurant) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    // IMPORTANT: never trust client prices. Re-fetch each item's real price.
    const itemIds = items.map((i) => i.itemId);
    const { data: dbItems, error: iErr } = await supabase
      .from("menu_items")
      .select("id, name, price, emoji, available")
      .in("id", itemIds)
      .eq("restaurant_id", restaurantId);

    if (iErr || !dbItems) {
      return NextResponse.json({ error: "Could not verify items" }, { status: 400 });
    }

    const priceMap = new Map(dbItems.map((d) => [d.id, d]));

    // Build verified line items.
    let subtotal = 0;
    const verified: OrderLineItem[] = [];
    for (const line of items) {
      const db = priceMap.get(line.itemId);
      if (!db || !db.available) {
        return NextResponse.json(
          { error: `Item unavailable: ${line.name}` },
          { status: 400 }
        );
      }
      const qty = Math.max(1, Math.floor(line.qty));
      subtotal += db.price * qty;
      verified.push({
        itemId: db.id,
        name: db.name,
        emoji: db.emoji,
        price: db.price,
        qty,
        mods: line.mods ?? {},
        notes: line.notes,
      });
    }

    const serviceFee = +(subtotal * (restaurant.service_pct / 100)).toFixed(2);
    const total = +(subtotal + serviceFee).toFixed(2);

    // Create the pending order first so the webhook can find it.
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .insert({
        restaurant_id: restaurantId,
        table_id: tableId,
        table_label: tableLabel,
        status: "pending_payment",
        subtotal,
        service_fee: serviceFee,
        total,
        currency: restaurant.currency,
        items: verified,
        note: note ?? null,
        paid: false,
      })
      .select("id")
      .single();

    if (oErr || !order) {
      return NextResponse.json({ error: "Could not create order" }, { status: 500 });
    }

    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const cur = restaurant.currency.toLowerCase();

    // Line items for Stripe (amounts in the smallest currency unit).
    const line_items: import("stripe").Stripe.Checkout.SessionCreateParams.LineItem[] =
      verified.map((v) => {
        const modText = Object.entries(v.mods)
          .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(", ") : val}`)
          .join(" · ");
        return {
          quantity: v.qty,
          price_data: {
            currency: cur,
            unit_amount: Math.round(v.price * 100),
            product_data: {
              name: `${v.emoji} ${v.name}`,
              ...(modText ? { description: modText } : {}),
            },
          },
        };
      });

    if (serviceFee > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: cur,
          unit_amount: Math.round(serviceFee * 100),
          product_data: { name: `Service charge (${restaurant.service_pct}%)` },
        },
      });
    }

    // Stripe Checkout supports card, Apple Pay and Google Pay automatically
    // via the card payment method (wallets show on supported devices).
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${origin}/order/${order.id}?paid=1`,
      cancel_url: `${origin}/r/${restaurantId}/t/${tableId ?? ""}?cancelled=1`,
      metadata: { order_id: order.id },
      payment_intent_data: { metadata: { order_id: order.id } },
    });

    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    return NextResponse.json({ url: session.url, orderId: order.id });
  } catch (err) {
    console.error("checkout error", err);
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
