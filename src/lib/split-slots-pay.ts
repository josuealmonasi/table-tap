import { resolveSelectedSplitPages } from "@/lib/split-page-recovery";
import Stripe from "stripe";
import { type NextRequest, NextResponse } from "next/server";
import type { TableMember } from "@/lib/table-membership";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlan } from "@/lib/plan-server";
import { openDinerAttempt, resumeDinerAttempt } from "@/lib/diner-attempt";
import { feeMetadata, NO_FEE, reserveFeeCents } from "@/lib/platform-fee";
import { siteOrigin } from "@/lib/site-origin";
import { stripeProductName } from "@/lib/stripe-limits";
import { readSlotSplit } from "@/lib/split-slots-access";
import { SplitReservationRejected } from "@/lib/split-slots-attempt";
import { splitResponse } from "@/lib/split-slots-rpc";
import { splitCents, splitRevision, splitSelection, type SplitScope } from "@/lib/split-slots";

export interface SlotPayBody extends SplitScope {
  splitId: string; revision?: number; slots?: number[]; expectedCents?: number; tipCents?: number;
  tipAmount?: number; tipPct?: number; couponCode?: string;
}
export async function paySplitSlots(req: NextRequest, body: SlotPayBody, member: TableMember): Promise<NextResponse> {
  if (!splitRevision(body.revision) || !splitSelection(body.slots) || !splitCents(body.expectedCents)
    || (body.tipCents !== undefined && !splitCents(body.tipCents)) || body.couponCode || body.tipAmount !== undefined || body.tipPct !== undefined) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  try {
    const split = await readSlotSplit(body, body.splitId);
    if (!split || split.status !== "locked") return await splitResponse({ outcome: "gone" }, []);
    const db = createAdminClient();
    const { data: restaurant, error } = await db.from("restaurants")
      .select("name, stripe_account_id, stripe_charges_enabled").eq("id", body.restaurantId).single();
    if (error) throw new Error("Could not read card availability");
    if (!restaurant?.stripe_account_id || !restaurant.stripe_charges_enabled) return await apiError("apiErr.noCardPayments", 409);
    const slots = [...body.slots].sort((a, b) => a - b);
    // A phone can reopen only its own grouped checkout. Its original tip and
    // fee stay frozen even if the next tap sends different values.
    const scopeKey = `split2:${split.id}:${body.revision}:${member.id}:${slots.join(",")}`;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const prior = await resumeDinerAttempt(stripe, body.restaurantId, scopeKey);
    if (prior) return NextResponse.json({ url: prior.url });
    if (split.revision !== body.revision) return await splitResponse({ outcome: "stale", revision: split.revision }, []);
    const readSelected = () => db.from("bill_split_slots")
      .select("share_no, amount_cents, fee_slice_cents, payment_id, reserved_checkout_id")
      .eq("restaurant_id", body.restaurantId).eq("split_id", split.id).in("share_no", slots);
    let { data: selected, error: slotsError } = await readSelected();
    if (!slotsError && selected?.some(s => s.reserved_checkout_id)
      && await resolveSelectedSplitPages(body.restaurantId, split.id, slots) === "closed") {
      ({ data: selected, error: slotsError } = await readSelected());
    }
    if (slotsError || selected?.length !== slots.length) throw new Error("Could not read split slots");
    if (selected.some(s => s.payment_id)) return await splitResponse({ outcome: "paid" }, []);
    if (selected.some(s => s.reserved_checkout_id)) return await splitResponse({ outcome: "taken" }, []);
    const amount = selected.reduce((sum, s) => sum + s.amount_cents, 0);
    if (amount !== body.expectedCents) return await splitResponse({ outcome: "stale", amount_cents: amount }, []);
    if (amount < (split.currency === "USD" ? 50 : 1000)) return await splitResponse({ outcome: "below_minimum", amount_cents: amount }, []);
    // Never silently reduce a tip the diner chose. Tips are outside both the
    // frozen debt and its fee budget, and may be at most the parts being paid.
    const tip = body.tipCents ?? 0;
    if (tip > amount || !splitCents(amount + tip)) return await apiError("apiErr.invalidRequest", 400);
    const plan = await getPlan(body.restaurantId);
    const slice = selected.reduce((sum, s) => sum + s.fee_slice_cents, 0);
    const fee = plan ? await reserveFeeCents(body.restaurantId, plan.limits, slice, "split") : NO_FEE;
    const origin = siteOrigin(req);
    const session = await openDinerAttempt(stripe, {
      mode: "payment",
      // Keep the existing card-only checkout: a voucher can leave served food unpaid.
      payment_method_types: ["card"],
      line_items: [{ quantity: 1, price_data: { currency: split.currency.toLowerCase(), unit_amount: amount + tip,
        product_data: { name: stripeProductName(restaurant.name) } } }],
      metadata: { restaurant_id: body.restaurantId, split_id: split.id, split_model: "2",
        split_revision: String(body.revision), split_member: member.id, split_slots: JSON.stringify(slots),
        split_amount: String(amount / 100), settle_tip: String(tip / 100), ...feeMetadata(fee, body.restaurantId) },
      payment_intent_data: { metadata: feeMetadata(fee, body.restaurantId), ...(fee.cents ? { application_fee_amount: fee.cents } : {}) },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${origin}/r/${body.restaurantId}/t/${body.tableId}?settled=1`,
      cancel_url: `${origin}/r/${body.restaurantId}/t/${body.tableId}?cancelled=1`,
    }, { restaurantId: body.restaurantId, stripeAccount: restaurant.stripe_account_id, currency: split.currency,
      amountCents: amount + tip, orderIds: split.order_ids, payableIds: [], scopeKey, foodPrincipal: Number(split.food_principal) });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof SplitReservationRejected) return await splitResponse(error.result, []);
    return await apiError("apiErr.checkoutFailed", 502);
  }
}
