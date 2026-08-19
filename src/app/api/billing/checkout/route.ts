import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { currentPrice } from "@/lib/founding";
import { foundersTaken } from "@/lib/plan-server";
import { actingOwner } from "@/lib/api-guard";
import { isSelfServe, readPlanName } from "@/lib/billing";
import { planLabel } from "@/lib/plan";
import { allPlans } from "@/lib/plan-server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// POST /api/billing/checkout — the owner subscribes to a tier.
//
// Only the owner: a manager runs the restaurant, but the card is the owner's
// decision. The plan is re-read from our own catalogue rather than trusted
// from the request, so a doctored body can't buy Casa at Servicio's price.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = (await req.json()) as { plan?: unknown };
  const plan = readPlanName(body.plan);
  if (!plan || !isSelfServe(plan)) return await apiError("apiErr.pickPlan", 400);

  const limits = (await allPlans()).find(p => p.plan === plan);
  // El precio sube solo al llenarse el lugar 50: se calcula aquí, con el mismo
  // conteo que vio la pantalla de Plan, para que lo que se cobra y lo que se
  // mostró no puedan discrepar.
  const taken = await foundersTaken();
  if (!limits) return await apiError("apiErr.pickPlan", 400);

  const db = createAdminClient();
  const { data: restaurant } = await db
    .from("restaurants")
    .select("name, currency, stripe_customer_id")
    .eq("id", actor.restaurantId)
    .single();
  if (!restaurant) return await apiError("apiErr.forbidden", 403);

  // One customer per restaurant, reused for every later change of plan, so
  // Stripe keeps one billing history rather than one per subscription.
  let customerId = restaurant.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: actor.email,
      name: restaurant.name,
      metadata: { restaurant_id: actor.restaurantId },
    });
    customerId = customer.id;
    await db
      .from("restaurants")
      .update({ stripe_customer_id: customerId })
      .eq("id", actor.restaurantId);
  }

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    // The catalogue lives in our database, so a tier with no Stripe Price of
    // its own is still buyable: the line item is built from the same number
    // the plan screen showed them.
    line_items: [
      limits.stripe_price_id
        ? { price: limits.stripe_price_id, quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: (restaurant.currency ?? "MXN").toLowerCase(),
              unit_amount: Math.round(currentPrice(limits, taken) * 100),
              recurring: { interval: "month" },
              product_data: { name: `TableTap ${planLabel(plan)}` },
            },
          },
    ],
    // The only trusted signal about who bought what: the webhook reads these
    // back rather than believing anything the browser returns with.
    client_reference_id: actor.restaurantId,
    subscription_data: { metadata: { restaurant_id: actor.restaurantId, plan } },
    metadata: { restaurant_id: actor.restaurantId, plan },
    // The dashboard, until there is a plan screen to land on. Somebody who
    // has just paid must never arrive at a 404.
    success_url: `${origin}/dashboard?subscribed=1`,
    cancel_url: `${origin}/dashboard`,
  });

  if (!session.url) return await apiError("apiErr.generic", 502);
  return NextResponse.json({ url: session.url });
}
