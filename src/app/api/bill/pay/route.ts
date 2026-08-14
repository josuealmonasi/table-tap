import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformFeeCents } from "@/lib/money";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// POST /api/bill/pay
// Body: { restaurantId, tableId, orderIds: string[] }
//
// Settles orders that already exist and are already with the kitchen. The cart
// route can't do this: it prices a cart and creates an order, while this one
// charges for food that has been cooking for an hour.
//
// The amount is summed from the stored order rows, never from the request. A
// caller can choose WHICH of the table's orders to settle — that is the "pay
// mine / pay everything" choice — but not what they cost.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`billpay:${clientIp(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const { restaurantId, tableId, orderIds, tipPct, tipAmount } = (await req.json()) as {
    restaurantId?: string;
    tableId?: string;
    orderIds?: string[];
    tipPct?: number;
    tipAmount?: number;
  };
  if (!restaurantId || !tableId || !Array.isArray(orderIds) || orderIds.length === 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();

  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, name, currency, stripe_account_id, stripe_charges_enabled")
    .eq("id", restaurantId)
    .single();
  if (!restaurant) return await apiError("apiErr.restaurantNotFound", 404);
  if (!restaurant.stripe_account_id || !restaurant.stripe_charges_enabled) {
    return await apiError("apiErr.noCardPayments", 409);
  }

  // Scoped by restaurant AND table, so an id from somewhere else matches
  // nothing. Already-paid and cancelled rows are excluded here rather than
  // filtered afterwards: paying twice for the same food is the failure that
  // matters most.
  const { data: rows } = await db
    .from("orders")
    .select("id, total, currency, items, paid, status")
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled")
    .in("id", orderIds);

  const orders = (rows ?? []) as Pick<Order, "id" | "total" | "items">[];
  if (orders.length === 0) return await apiError("apiErr.billSettled", 409);

  const food = orders.reduce((sum, o) => sum + Number(o.total), 0);

  // The tip is the one figure the diner sets, so it is clamped the same way the
  // cart clamps it: never negative, never more than the food it is thanking
  // somebody for. A percentage is recomputed here rather than trusted, so a
  // request cannot claim 15% and send a different number.
  const pct = Math.min(100, Math.max(0, Number(tipPct) || 0));
  const asked = tipAmount != null ? Number(tipAmount) : (food * pct) / 100;
  const tip = Math.min(Math.max(0, round2(asked)), food);

  const amount = round2(food + tip);
  const cents = Math.round(amount * 100);
  if (cents <= 0) return await apiError("apiErr.billSettled", 409);

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: restaurant.currency.toLowerCase(),
              unit_amount: cents,
              // One line: the diner is settling a bill, not re-picking dishes,
              // and the itemised list is on the screen they came from.
              product_data: {
                name: `${restaurant.name} — ${orders.length} ${orders.length === 1 ? "order" : "orders"}`,
              },
            },
          },
        ],
        // The webhook marks exactly these rows paid. It is the only thing that
        // does: a returning browser proves nothing about whether money moved.
        metadata: {
          settle_order_ids: orders.map(o => o.id).join(","),
          // Recorded so the takings show what was actually collected. It lands
          // on one of the settled orders rather than being split across them:
          // a tip is for the table's service, not attributable to a dish.
          settle_tip: String(tip),
        },
        payment_intent_data: {
          application_fee_amount: platformFeeCents(cents),
        },
        success_url: `${origin}/r/${restaurantId}/t/${tableId}?settled=1`,
        cancel_url: `${origin}/r/${restaurantId}/t/${tableId}?cancelled=1`,
      },
      { stripeAccount: restaurant.stripe_account_id },
    );

    return NextResponse.json({ url: session.url });
  } catch {
    return await apiError("apiErr.checkoutFailed", 502);
  }
}
