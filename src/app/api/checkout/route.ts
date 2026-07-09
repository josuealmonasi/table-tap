import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderLineItem, OrderExtra } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/checkout
// Body: { restaurantId, tableId, tableLabel, items: OrderLineItem[], note }
// Creates a pending order, then a Stripe Checkout Session, and returns its URL.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { restaurantId, tableId, tableLabel, items, note, tipPct: rawTipPct } = body as {
      restaurantId: string;
      tableId: string | null;
      tableLabel: string | null;
      items: OrderLineItem[];
      note?: string;
      tipPct?: number;
    };

    // Only the preset tip percentages are accepted — the amount itself is
    // always recomputed from the verified subtotal, never taken from the client.
    const tipPct = [0, 10, 15, 20].includes(rawTipPct ?? 0) ? (rawTipPct ?? 0) : 0;

    if (!restaurantId || !items?.length) {
      return NextResponse.json({ error: "Missing order data" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Re-fetch the restaurant to get the authoritative service % and currency.
    const { data: restaurant, error: rErr } = await supabase
      .from("restaurants")
      .select("id, currency, service_pct, service_enabled, accepting_orders")
      .eq("id", restaurantId)
      .single();

    if (rErr || !restaurant) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    // Kill switch: the owner paused orders (maybe after this page loaded).
    if (!restaurant.accepting_orders) {
      return NextResponse.json(
        { error: "The restaurant isn't taking orders right now. Please try again later." },
        { status: 409 }
      );
    }

    // IMPORTANT: never trust client prices. Re-fetch every referenced item
    // (products AND extras) and use the DB's real price.
    const referencedIds = [
      ...new Set(items.flatMap((i) => [i.itemId, ...(i.extras?.map((e) => e.id) ?? [])])),
    ];
    const { data: dbItems, error: iErr } = await supabase
      .from("menu_items")
      .select("id, name, price, emoji, available")
      .in("id", referencedIds)
      .eq("restaurant_id", restaurantId);

    if (iErr || !dbItems) {
      return NextResponse.json({ error: "Could not verify items" }, { status: 400 });
    }

    const priceMap = new Map(dbItems.map((d) => [d.id, d]));

    // Build verified line items with DB prices for the product and its extras.
    let subtotal = 0;
    const verified: OrderLineItem[] = [];
    const removedExtras = new Map<string, string>(); // extra id → name (deduped)
    for (const line of items) {
      const db = priceMap.get(line.itemId);
      if (!db || !db.available) {
        return NextResponse.json(
          { error: `${line.name} is no longer available.`, unavailableItemId: line.itemId },
          { status: 400 }
        );
      }

      // An extra that went unavailable is never charged. We collect them and,
      // below, tell the client to drop them + review before paying.
      const verifiedExtras: OrderExtra[] = [];
      for (const extra of line.extras ?? []) {
        const dbExtra = priceMap.get(extra.id);
        if (!dbExtra || !dbExtra.available) {
          removedExtras.set(extra.id, extra.name);
          continue;
        }
        verifiedExtras.push({
          id: dbExtra.id,
          name: dbExtra.name,
          emoji: dbExtra.emoji,
          price: dbExtra.price,
        });
      }

      const qty = Math.max(1, Math.floor(line.qty));
      const unit = db.price + verifiedExtras.reduce((s, e) => s + e.price, 0);
      subtotal += unit * qty;
      verified.push({
        itemId: db.id,
        name: db.name,
        emoji: db.emoji,
        price: db.price,
        qty,
        mods: line.mods ?? {},
        extras: verifiedExtras.length ? verifiedExtras : undefined,
        notes: line.notes,
      });
    }

    // If any extras dropped out, don't charge yet — let the customer see what
    // changed and confirm. The client removes them and re-submits.
    if (removedExtras.size > 0) {
      return NextResponse.json(
        { removedExtraIds: [...removedExtras.keys()], removedExtraNames: [...removedExtras.values()] },
        { status: 409 }
      );
    }

    // The service charge only applies when the owner switched it on.
    const servicePct = restaurant.service_enabled ? restaurant.service_pct : 0;
    const serviceFee = +(subtotal * (servicePct / 100)).toFixed(2);
    const tip = +(subtotal * (tipPct / 100)).toFixed(2);
    const total = +(subtotal + serviceFee + tip).toFixed(2);

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
        tip,
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
        const extrasText = v.extras?.length
          ? `Extras: ${v.extras.map((e) => e.name).join(", ")}`
          : "";
        const description = [modText, extrasText].filter(Boolean).join(" · ");
        const unitAmount = v.price + (v.extras?.reduce((s, e) => s + e.price, 0) ?? 0);
        return {
          quantity: v.qty,
          price_data: {
            currency: cur,
            unit_amount: Math.round(unitAmount * 100),
            product_data: {
              name: `${v.emoji ? `${v.emoji} ` : ""}${v.name}`,
              ...(description ? { description } : {}),
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
          product_data: { name: `Service charge (${servicePct}%)` },
        },
      });
    }

    if (tip > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: cur,
          unit_amount: Math.round(tip * 100),
          product_data: { name: `Tip (${tipPct}%)` },
        },
      });
    }

    // Stripe Checkout supports card, Apple Pay and Google Pay automatically
    // via the card payment method (wallets show on supported devices).
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        success_url: `${origin}/order/${order.id}?paid=1`,
        cancel_url: `${origin}/r/${restaurantId}${tableId ? `/t/${tableId}` : ""}?cancelled=1`,
        metadata: { order_id: order.id },
        payment_intent_data: { metadata: { order_id: order.id } },
      });
    } catch (err) {
      // Stripe refused the session — the pending order will never be paid,
      // so remove it instead of leaving an orphan row.
      await supabase.from("orders").delete().eq("id", order.id);
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      if (code === "amount_too_small") {
        return NextResponse.json(
          { error: "That total is below the card minimum — please add a little more to your order." },
          { status: 400 }
        );
      }
      throw err; // anything else falls through to the generic handler below
    }

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
