import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformFeeCents } from "@/lib/money";
import { itemSalePrice, priceCart, type AppliedCoupon } from "@/lib/pricing";
import {
  claimCoupon,
  couponProblem,
  findCoupon,
  logRedemption,
  releaseCoupon,
  toAppliedCoupon,
  type CouponRow,
} from "@/lib/coupon-service";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { fetchPromotions } from "@/lib/promotions-data";
import { buildCombos, toCartPromos } from "@/lib/promotions";
import type { OrderLineItem, OrderExtra, MenuItem, Modifier } from "@/lib/types";
import { missingRequired } from "@/lib/modifiers";

export const runtime = "nodejs";

// POST /api/checkout
// Body: { restaurantId, tableId, tableLabel, items: OrderLineItem[], note }
// Creates a pending order, then a Stripe Checkout Session, and returns its URL.
export async function POST(req: NextRequest) {
  try {
    // Throttle abusive callers before we create any orders or Stripe sessions.
    if (await isRateLimited(`checkout:${clientIp(req)}`, 10, 60)) {
      return NextResponse.json(
        { error: "Too many attempts — please wait a moment and try again." },
        { status: 429 },
      );
    }

    const body = await req.json();
    const {
      restaurantId,
      tableId,
      tableLabel,
      items,
      note,
      tipPct: rawTipPct,
      tipAmount: rawTipAmount,
      couponCode,
    } = body as {
      restaurantId: string;
      tableId: string | null;
      tableLabel: string | null;
      items: OrderLineItem[];
      note?: string;
      tipPct?: number;
      tipAmount?: number;
      couponCode?: string;
    };

    // Tips: either a preset percentage (recomputed from the verified subtotal)
    // or an exact "Other" amount — sanitised and capped below once the
    // subtotal is known.
    const tipPct = [0, 10, 15, 20].includes(rawTipPct ?? 0) ? (rawTipPct ?? 0) : 0;
    const tipAmount =
      Number.isFinite(rawTipAmount) && (rawTipAmount as number) > 0
        ? +(rawTipAmount as number).toFixed(2)
        : null;

    if (!restaurantId || !items?.length) {
      return NextResponse.json({ error: "Missing order data" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Re-fetch the restaurant to get the authoritative service % and currency.
    const { data: restaurant, error: rErr } = await supabase
      .from("restaurants")
      .select(
        "id, currency, service_pct, service_enabled, accepting_orders, tax_pct, stripe_account_id, stripe_charges_enabled",
      )
      .eq("id", restaurantId)
      .single();

    if (rErr || !restaurant) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    // Kill switch: the owner paused orders (maybe after this page loaded).
    if (!restaurant.accepting_orders) {
      return NextResponse.json(
        {
          error: "The restaurant isn't taking orders right now. Please try again later.",
        },
        { status: 409 },
      );
    }

    // No payouts without a connected Stripe account: refuse to charge a card
    // when we'd have nowhere to send the money. The owner completes onboarding
    // in Settings → Payments before customers can check out.
    if (!restaurant.stripe_account_id || !restaurant.stripe_charges_enabled) {
      return NextResponse.json(
        {
          error:
            "This restaurant isn't set up to take card payments yet. Please let the staff know.",
        },
        { status: 409 },
      );
    }

    // Promotions come from the DB too, so a combo's price and a quantity deal's
    // terms are never the client's to decide.
    const promotions = await fetchPromotions(supabase, restaurantId, {
      activeOnly: true,
    });
    const cartPromos = toCartPromos(promotions);

    // Combo lines are priced as a bundle and verified separately below.
    const comboLines = items.filter(i => i.comboId);
    const plainLines = items.filter(i => !i.comboId);

    // A combo's components come from ITS promotion row, not from the request —
    // otherwise a client could list different components than the bundle
    // actually contains.
    const requestedComboIds = new Set(comboLines.map(l => l.comboId));
    const comboComponentIds = promotions
      .filter(p => requestedComboIds.has(p.id))
      .flatMap(p => p.items.map(i => i.item_id));

    // IMPORTANT: never trust client prices. Re-fetch every referenced item
    // (products AND extras) and use the DB's real price. Combo components are
    // included so we can check they're all still available.
    const referencedIds = [
      ...new Set([
        ...plainLines.flatMap(i => [i.itemId, ...(i.extras?.map(e => e.id) ?? [])]),
        ...comboComponentIds,
        // A bundle's extras are priced from the DB too, so they have to be
        // fetched here — without this they'd be missing from priceMap and the
        // verification below would drop every one as "unavailable".
        ...comboLines.flatMap(i => i.extras?.map(e => e.id) ?? []),
      ]),
    ];
    const { data: dbItems, error: iErr } = await supabase
      .from("menu_items")
      .select("id, name, price, emoji, available, discount_pct, modifiers")
      .in("id", referencedIds)
      .eq("restaurant_id", restaurantId);

    if (iErr || !dbItems) {
      return NextResponse.json({ error: "Could not verify items" }, { status: 400 });
    }

    const priceMap = new Map(dbItems.map(d => [d.id, d]));

    // Build verified line items with DB prices for the product and its extras.
    const verified: OrderLineItem[] = [];
    const removedExtras = new Map<string, string>(); // extra id → name (deduped)

    // Combos: the bundle must still exist, be active, and have every component
    // available. Its price comes from the promotion row, never the request.
    const combosById = new Map(
      buildCombos(
        promotions,
        new Map(dbItems.map(d => [d.id, d as unknown as MenuItem])),
      ).map(c => [c.id, c]),
    );
    for (const line of comboLines) {
      const combo = combosById.get(line.comboId!);
      if (!combo) {
        return NextResponse.json(
          {
            error: `${line.name} is no longer available.`,
            unavailableItemId: line.itemId,
          },
          { status: 400 },
        );
      }
      // Extras chosen inside the bundle are charged on top of it, so they get
      // the same treatment as an ordinary line's: re-priced from the DB and
      // dropped if they've gone unavailable. Trusting the client here would
      // let a forged payload attach a MX$0 truffle oil to a MX$5 deal.
      const comboExtras: OrderExtra[] = [];
      for (const extra of line.extras ?? []) {
        const dbExtra = priceMap.get(extra.id);
        if (!dbExtra || !dbExtra.available) {
          removedExtras.set(extra.id, extra.name);
          continue;
        }
        comboExtras.push({
          id: dbExtra.id,
          name: dbExtra.name,
          emoji: dbExtra.emoji,
          price: dbExtra.price,
        });
      }

      // Required option groups apply per component: a deal containing a steak
      // can't be ordered without its doneness any more than the steak could
      // be on its own.
      for (const component of line.components ?? []) {
        const product = priceMap.get(component.itemId);
        if (!product) continue;
        const unanswered = missingRequired(
          (product.modifiers as Modifier[] | null) ?? [],
          component.mods,
        );
        if (unanswered.length > 0) {
          return NextResponse.json(
            {
              error: `Choose ${unanswered.join(", ")} for ${component.name} before ordering.`,
              missingModifiers: unanswered,
              unansweredItemId: component.itemId,
            },
            { status: 400 },
          );
        }
      }

      verified.push({
        itemId: combo.id,
        comboId: combo.id,
        name: combo.name,
        emoji: combo.emoji || "🎁",
        // The bundle price, from the promotion row. Extras sit alongside it and
        // priceCart sums them — the deal fixes what the dishes cost, not what
        // an upgrade costs.
        price: combo.price,
        qty: Math.max(1, Math.floor(line.qty)),
        mods: {},
        // The client's per-component choices are kept for the kitchen ticket
        // (they're instructions, not money), but every component and its
        // structure comes from the DB-built combo.
        components: combo.components.map(c => {
          const chosen = (line.components ?? []).find(x => x.itemId === c.itemId);
          return chosen ? { ...c, mods: chosen.mods, extras: chosen.extras } : c;
        }),
        ...(comboExtras.length > 0 ? { extras: comboExtras } : {}),
        notes: line.notes,
      });
    }

    for (const line of plainLines) {
      const db = priceMap.get(line.itemId);
      if (!db || !db.available) {
        return NextResponse.json(
          {
            error: `${line.name} is no longer available.`,
            unavailableItemId: line.itemId,
          },
          { status: 400 },
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

      // Required option groups, checked against the DB's modifiers rather than
      // the client's. The customer screen already disables "Add to cart" for
      // this, but that copy can be stale (a tab left open while the manager
      // marked a group required) or simply absent, so this is the one that
      // decides — otherwise the kitchen gets a ticket it can't cook from.
      const unanswered = missingRequired(
        (db.modifiers as Modifier[] | null) ?? [],
        line.mods,
      );
      if (unanswered.length > 0) {
        return NextResponse.json(
          {
            error: `Choose ${unanswered.join(", ")} for ${db.name} before ordering.`,
            missingModifiers: unanswered,
            unansweredItemId: db.id,
          },
          { status: 400 },
        );
      }

      const qty = Math.max(1, Math.floor(line.qty));
      verified.push({
        itemId: db.id,
        name: db.name,
        emoji: db.emoji,
        price: db.price,
        // From the DB, never the client — a forged discount would otherwise
        // let a customer set their own price.
        discountPct: Number(db.discount_pct) || 0,
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
        {
          removedExtraIds: [...removedExtras.keys()],
          removedExtraNames: [...removedExtras.values()],
        },
        { status: 409 },
      );
    }

    // THE authoritative price. Same function the customer's cart ran, but fed
    // DB-verified prices — so the amount charged is never the client's opinion.
    // It also caps an exact tip at the subtotal (guards fat fingers and abuse).
    const priceWith = (coupon: AppliedCoupon | null) =>
      priceCart({
        items: verified,
        servicePct: restaurant.service_pct,
        serviceEnabled: restaurant.service_enabled,
        tipPct,
        tipAmount,
        coupon,
        promos: cartPromos,
      });

    // Price once without the coupon: that subtotal is what its minimum-spend
    // rule is judged against.
    const base = priceWith(null);

    // The code is re-checked here from the DB — a client that skipped or faked
    // /validate gets no advantage, and the claim below is what enforces the
    // usage cap under concurrency.
    let coupon: CouponRow | null = null;
    if (typeof couponCode === "string" && couponCode.trim()) {
      const found = await findCoupon(restaurantId, couponCode);
      if (!found) {
        return NextResponse.json({ couponReason: "notFound" }, { status: 409 });
      }
      const problem = couponProblem(found, base.subtotal);
      if (problem) {
        return NextResponse.json({ couponReason: problem }, { status: 409 });
      }
      // Reserve the use now. If anything below fails we hand it back.
      if (!(await claimCoupon(found.id))) {
        return NextResponse.json({ couponReason: "limitReached" }, { status: 409 });
      }
      coupon = found;
    }

    const pricing = coupon ? priceWith(toAppliedCoupon(coupon)) : base;
    const { subtotal, serviceFee, tip, total } = pricing;
    const servicePct = restaurant.service_enabled ? restaurant.service_pct : 0;

    /** Give back a reserved coupon use when this checkout doesn't complete. */
    const undoClaim = async () => {
      if (coupon) await releaseCoupon(coupon.id);
    };

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
        tax_pct: Number(restaurant.tax_pct) || 0,
        discount: pricing.discount,
        coupon_code: coupon?.code ?? null,
        // Where the discount came from, so the owner can tell a menu sale from
        // a quantity deal from a coupon when reviewing an order later.
        promo_detail:
          pricing.discount > 0
            ? {
                item: pricing.itemDiscount,
                promos: pricing.promoDiscount,
                coupon: pricing.couponDiscount,
              }
            : null,
        total,
        currency: restaurant.currency,
        items: verified,
        note: note ?? null,
        paid: false,
      })
      .select("id")
      .single();

    if (oErr || !order) {
      await undoClaim();
      return NextResponse.json({ error: "Could not create order" }, { status: 500 });
    }

    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const cur = restaurant.currency.toLowerCase();

    // Line items for Stripe (amounts in the smallest currency unit).
    const line_items: import("stripe").Stripe.Checkout.SessionCreateParams.LineItem[] =
      verified.map(v => {
        const modText = Object.entries(v.mods)
          .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(", ") : val}`)
          .join(" · ");
        const extrasText = v.extras?.length
          ? `Extras: ${v.extras.map(e => e.name).join(", ")}`
          : "";
        const description = [modText, extrasText].filter(Boolean).join(" · ");
        // Charge the sale price. Discounting the line itself (rather than
        // bolting a credit on the end) keeps the Stripe receipt honest about
        // what each item actually cost.
        const unitAmount =
          itemSalePrice(v.price, v.discountPct) +
          (v.extras?.reduce((s, e) => s + e.price, 0) ?? 0);
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
          product_data: { name: tipAmount !== null ? "Tip" : `Tip (${tipPct}%)` },
        },
      });
    }

    // Stripe Checkout supports card, Apple Pay and Google Pay automatically
    // via the card payment method (wallets show on supported devices).
    // Destination charge: the platform creates the charge, then routes the funds
    // to the restaurant's connected account. An optional platform fee (0 by
    // default) is skimmed as an application fee.
    const appFee = platformFeeCents(Math.round(total * 100));

    // Item discounts are already baked into each line's unit_amount. What's
    // left — the coupon and any quantity deal — is money off the order as a
    // whole, and Stripe has no negative line item, so it goes on as a one-off
    // coupon. The line items minus this equals `total` exactly.
    const amountOffCents = Math.round(
      (pricing.couponDiscount + pricing.promoDiscount) * 100,
    );

    let session;
    try {
      const discounts =
        amountOffCents > 0
          ? [
              {
                coupon: (
                  await stripe.coupons.create({
                    amount_off: amountOffCents,
                    currency: cur,
                    duration: "once",
                    name: coupon ? `Coupon ${coupon.code}` : "Discount",
                  })
                ).id,
              },
            ]
          : undefined;

      session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        ...(discounts ? { discounts } : {}),
        success_url: `${origin}/order/${order.id}?paid=1`,
        cancel_url: `${origin}/r/${restaurantId}${tableId ? `/t/${tableId}` : ""}?cancelled=1`,
        metadata: { order_id: order.id },
        payment_intent_data: {
          metadata: { order_id: order.id },
          transfer_data: { destination: restaurant.stripe_account_id },
          ...(appFee > 0 ? { application_fee_amount: appFee } : {}),
        },
      });
    } catch (err) {
      // Stripe refused the session — the pending order will never be paid, so
      // remove it instead of leaving an orphan row, and give back the coupon
      // use we reserved.
      await supabase.from("orders").delete().eq("id", order.id);
      await undoClaim();
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      if (code === "amount_too_small") {
        return NextResponse.json(
          {
            error:
              "That total is below the card minimum — please add a little more to your order.",
          },
          { status: 400 },
        );
      }
      throw err; // anything else falls through to the generic handler below
    }

    // The use is committed now that there's a real session to pay for.
    if (coupon) {
      await logRedemption({
        restaurantId,
        couponId: coupon.id,
        orderId: order.id,
        code: coupon.code,
        amount: pricing.couponDiscount,
      });
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
