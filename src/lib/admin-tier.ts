import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { assignedPayPath } from "@/lib/assigned-pay-path";
import { stripe } from "@/lib/stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { invalidatePublicMenu } from "@/lib/public-menu-cache";
import { BillingError, withRestaurantBilling } from "@/lib/billing-operation";
import { restaurantBilling } from "@/lib/billing-state";
import { BILLING_CURRENCY, checkoutPrice } from "@/lib/billing-price";
import { subscriptionPlan } from "@/lib/subscription-price";
import { applySubscription } from "@/lib/subscription-sync";
import { foundersTaken, allPlans } from "@/lib/plan-server";
import { moveRestaurantPlan } from "@/lib/admin-plan";
import { sendMail } from "@/lib/mail";
import { escapeHtml } from "@/lib/html";
import { planLabel } from "@/lib/plan";
import { messagesFor, translate, DEFAULT_LOCALE } from "@/lib/i18n";
import { dateLocale } from "@/lib/format";

type Db = ReturnType<typeof createAdminClient>;

/**
 * How a platform admin's tier assignment is paid for.
 *
 * - `next_bill`: the restaurant already pays through Stripe. Its subscription
 *   moves to the new tier's price with no proration, so the period already
 *   paid stays as paid and the next invoice is at the new price.
 * - `payment_link`: no subscription yet. The tier starts now as a trial that
 *   ends on the pay-by date, and the owner gets an email with a link that
 *   opens Checkout for exactly that tier. Unpaid by then, getPlan drops it to
 *   Carta the same way it ends any trial.
 * - `free`: an assignment with no charge at all (the original admin move).
 * - `test`: free, for a tester the owner is lending the app to. It also gives
 *   back the restaurant's founding place, if it holds one and no subscription
 *   is paying for it, so a tester never keeps a founder away.
 */
export type TierBilling = "next_bill" | "payment_link" | "free" | "test";
export const TIER_BILLING: TierBilling[] = ["next_bill", "payment_link", "free", "test"];

export type TierAnswer =
  | { ok: true; from: string; to: string; billing: TierBilling; payBy?: string; emailed?: boolean; seatReleased?: boolean }
  | { ok: false; error: string; status: number };

/** Days an owner has to pay a tier assigned with a payment link, unless the admin says otherwise. */
export const PAY_BY_DAYS = 7;
const MAX_PAY_BY_DAYS = 60;

/** The pay-by date: a future day no more than two months out, or the default. */
export function payByDate(value: unknown, now = Date.now()): string | null {
  if (value === undefined || value === null || value === "") {
    return new Date(now + PAY_BY_DAYS * 86_400_000).toISOString();
  }
  if (typeof value !== "string") return null;
  const at = new Date(value).getTime();
  if (!Number.isFinite(at) || at <= now || at > now + MAX_PAY_BY_DAYS * 86_400_000) return null;
  return new Date(at).toISOString();
}

/**
 * The link in the owner's email: it opens Checkout for the assigned tier once
 * they sign in. `a` binds it to this assignment's id, so a link from an
 * earlier or a replaced assignment opens nothing.
 */
export function assignedPayLink(origin: string, plan: string, assignmentId: string): string {
  return `${origin}${assignedPayPath(plan, assignmentId)}`;
}

export async function assignTier(
  db: Db,
  input: { restaurantId: string; plan: string; billing: TierBilling; payBy?: unknown; origin: string },
  adminEmail: string,
  client: Stripe = stripe,
): Promise<TierAnswer> {
  if (input.billing === "free" || input.billing === "test") {
    // Under the billing lock too, closing any open Checkout: a pay link opened
    // just before this free move could otherwise still be paid, and its
    // subscription would write over the tier given here (review finding 3).
    try {
      const moved = await withRestaurantBilling(db, input.restaurantId, async operation => {
        const { sessions, snapshot, exists } = await restaurantBilling(db, input.restaurantId);
        if (!exists) return { ok: false, error: "apiErr.restaurantNotFound", status: 404 } as const;
        await operation.record(snapshot);
        for (const session of sessions) await operation.write(() => client.checkout.sessions.expire(session.id));
        const result = await moveRestaurantPlan(db, input.restaurantId, input.plan, adminEmail, client);
        if (!result.ok || input.billing !== "test") return { ...result, seatReleased: false };
        return { ...result, seatReleased: await releaseFoundingSeat(db, input.restaurantId) };
      });
      return moved.ok ? { ...moved, billing: input.billing } : moved;
    } catch (err) {
      if (err instanceof BillingError) return { ok: false, error: err.key, status: err.status };
      console.error("admin free tier move failed", err);
      return { ok: false, error: "apiErr.billingUnavailable", status: 502 };
    }
  }
  // Carta costs nothing: there is no bill to move and no link to pay.
  if (input.plan === "carta") return { ok: false, error: "apiErr.tierCartaIsFree", status: 400 };
  const limits = (await allPlans()).find(p => p.plan === input.plan);
  if (!limits) return { ok: false, error: "apiErr.planUnknown", status: 400 };
  try {
    return input.billing === "next_bill"
      ? await rebill(db, input.restaurantId, limits, adminEmail, client)
      : await assignWithLink(db, input, adminEmail, client);
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: err.key, status: err.status };
    if ((err as { statusCode?: number })?.statusCode === 402) return { ok: false, error: "apiErr.billingPaymentFailed", status: 402 };
    console.error("admin tier assignment failed", err);
    return { ok: false, error: "apiErr.billingUnavailable", status: 502 };
  }
}

/**
 * Moves a live subscription to another tier's price from its next invoice.
 *
 * Under the same billing lock as the owner's own checkout, so an owner
 * changing plan at the same moment cannot leave two prices on one contract.
 * Only a subscription in good standing: prorating unpaid time is how a
 * restaurant gets credit it never earned, so an overdue one is settled first.
 */
async function rebill(
  db: Db, restaurantId: string, limits: Awaited<ReturnType<typeof allPlans>>[number],
  adminEmail: string, client: Stripe,
): Promise<TierAnswer> {
  return await withRestaurantBilling(db, restaurantId, async operation => {
    const { live, snapshot, exists } = await restaurantBilling(db, restaurantId);
    if (!exists) throw new BillingError("apiErr.restaurantNotFound", 404);
    await operation.record(snapshot);
    if (live.length === 0) throw new BillingError("apiErr.tierNoSubscription");
    if (live.length > 1) throw new BillingError("apiErr.billingConflict");
    const subscription = live[0];
    const item = subscription.items.data[0];
    if (subscription.metadata.restaurant_id !== restaurantId || subscription.items.data.length !== 1
      || item.price.currency !== BILLING_CURRENCY) {
      throw new BillingError("apiErr.billingConflict");
    }
    if (!["active", "trialing"].includes(subscription.status)) throw new BillingError("apiErr.tierSettleFirst");
    // An owner who scheduled the end of their subscription is not billed
    // again: promising "the next bill is at the new tier" would be false, and
    // moving it must not quietly undo their cancellation (review finding 4).
    if (subscription.cancel_at_period_end || subscription.cancel_at) throw new BillingError("apiErr.tierCancelScheduled");
    // Only a monthly contract moves to a monthly price with nothing charged
    // today; Stripe resets the cycle and bills at once when the interval
    // changes, whatever the proration setting (review finding 5).
    const recurring = item.price.recurring;
    if (recurring?.interval !== "month" || recurring.interval_count !== 1) throw new BillingError("apiErr.tierIntervalUnsupported");
    const from = await subscriptionPlan(subscription);
    if (from === limits.plan) return { ok: true, from, to: limits.plan, billing: "next_bill" } as const;

    const line = await checkoutPrice(limits, await foundersTaken());
    if (!line.price) throw new Error("Tier price has no Stripe Price");
    const updated = await operation.write(() => client.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: line.price as string, quantity: 1 }],
      metadata: { restaurant_id: restaurantId, plan: limits.plan },
      // The period already paid stays as it is: no credit, no charge today.
      // The next invoice is the first one at the new price.
      proration_behavior: "none",
    }, { timeout: 30000, maxNetworkRetries: 1, idempotencyKey: `admin-tier-${operation.token}` }));
    // The tier follows the Price at once, the same way the webhook would.
    await applySubscription(updated, db, client);
    await logEvent({
      restaurantId, actor: adminEmail, entity: "settings", action: "updated",
      detail: logDetail({ plan: `${from}→${limits.plan}`, by: "platform_admin", billing: "next_bill" }),
    });
    return { ok: true, from, to: limits.plan, billing: "next_bill" } as const;
  });
}

/**
 * Gives a restaurant with no subscription a tier now, to be paid by a date.
 *
 * Stored as the app's own trial, so everything that already ends trials ends
 * this one: getPlan and the database drop an unpaid one to Carta, and paying
 * through Checkout replaces it with the subscription. Refused when a
 * subscription is live, because that one is moved with `next_bill` instead.
 */
async function assignWithLink(
  db: Db, input: { restaurantId: string; plan: string; payBy?: unknown; origin: string }, adminEmail: string,
  client: Stripe,
): Promise<TierAnswer> {
  const payBy = payByDate(input.payBy);
  if (!payBy) return { ok: false, error: "apiErr.tierPayByInvalid", status: 400 };
  // Under the same billing lock as checkout: a Checkout page the owner left
  // open for another tier could otherwise be paid after this assignment and
  // its subscription would replace the tier (review 2026-11-17, finding 3).
  const assigned = await withRestaurantBilling(db, input.restaurantId, async operation => {
    const { live, sessions, snapshot, exists } = await restaurantBilling(db, input.restaurantId);
    if (!exists) return { ok: false, error: "apiErr.restaurantNotFound", status: 404 } as const;
    await operation.record(snapshot);
    if (live.length) return { ok: false, error: "apiErr.planHasSubscription", status: 409 } as const;
    // Close every open Checkout first. A failure throws (the move does not happen).
    for (const session of sessions) await operation.write(() => client.checkout.sessions.expire(session.id));
    return await writeAssignment(db, input, payBy);
  });
  if (!assigned.ok) return assigned;
  const { from, restaurant, assignmentId } = assigned;

  invalidatePublicMenu(input.restaurantId);

  const emailed = await mailOwner(db, {
    ownerId: restaurant.owner_id, restaurant: restaurant.name,
    plan: input.plan, payBy, link: assignedPayLink(input.origin, input.plan, assignmentId),
    key: `admin-tier/${input.restaurantId}/${assignmentId}`,
  });
  await logEvent({
    restaurantId: input.restaurantId, actor: adminEmail, entity: "settings", action: "updated",
    detail: logDetail({ plan: `${from}→${input.plan}`, by: "platform_admin", billing: "payment_link", pay_by: payBy.slice(0, 10) }),
  });
  return { ok: true, from, to: input.plan, billing: "payment_link", payBy, emailed };
}

/** The tier as the app's own trial until the pay-by date, over the sync revision it read. */
async function writeAssignment(
  db: Db, input: { restaurantId: string; plan: string }, payBy: string,
): Promise<{ ok: true; from: string; assignmentId: string; restaurant: { name: string; owner_id: string | null } } | { ok: false; error: string; status: number }> {
  const assignmentId = randomUUID();
  const { data: restaurant } = await db.from("restaurants")
    .select("name, plan, owner_id, subscription_sync_revision").eq("id", input.restaurantId).maybeSingle();
  if (!restaurant) return { ok: false, error: "apiErr.restaurantNotFound", status: 404 };
  const from = restaurant.plan as string;
  const revision = Number(restaurant.subscription_sync_revision ?? 0);
  // Over the revision read above, like every plan write: an owner who
  // subscribed in between keeps the subscription they paid for.
  const { data: moved, error } = await db.from("restaurants").update({
    plan: input.plan, plan_status: "trialing", trial_ends_at: payBy, plan_ends_at: null,
    stripe_subscription_id: null, subscription_sync_revision: revision + 1, tier_assignment_id: assignmentId,
  }).eq("id", input.restaurantId).eq("subscription_sync_revision", revision).select("id");
  if (error) {
    console.error("admin tier assignment failed:", error.message);
    return { ok: false, error: "apiErr.generic", status: 500 };
  }
  if (!moved?.length) return { ok: false, error: "apiErr.planChangedMeanwhile", status: 409 };
  return { ok: true, from, assignmentId, restaurant: { name: restaurant.name as string, owner_id: restaurant.owner_id as string | null } };
}

/** The owner's email with the link. False when it could not be sent: the admin is told so. */
async function mailOwner(
  db: Db, m: { ownerId: string | null; restaurant: string; plan: string; payBy: string; link: string; key: string },
): Promise<boolean> {
  if (!m.ownerId) return false;
  const { data } = await db.auth.admin.getUserById(m.ownerId);
  const to = data?.user?.email;
  if (!to) return false;
  const mail = tierMail({ restaurant: m.restaurant, plan: m.plan, payBy: m.payBy, link: m.link });
  const sent = await sendMail({ to, ...mail, idempotencyKey: m.key });
  return sent.sent;
}

/** The email itself, in the owner's language (Spanish: owners sign up in Mexico). */
export function tierMail(
  m: { restaurant: string; plan: string; payBy: string; link: string },
  locale = DEFAULT_LOCALE,
): { subject: string; text: string; html: string } {
  const messages = messagesFor(locale);
  const t = (key: string, vars?: Record<string, string | number>) => translate(messages, key, vars);
  const date = new Intl.DateTimeFormat(dateLocale(locale), { dateStyle: "long", timeZone: "America/Mexico_City" })
    .format(new Date(m.payBy));
  const vars = { restaurant: m.restaurant, plan: planLabel(m.plan), date };
  const subject = t("tierMail.subject", vars);
  const intro = t("tierMail.intro", vars);
  const after = t("tierMail.after", vars);
  const button = t("tierMail.button", vars);
  return {
    subject,
    text: `${intro}\n\n${button}: ${m.link}\n\n${after}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#16211C">`
      + `<p>${escapeHtml(intro)}</p>`
      + `<p><a href="${escapeHtml(m.link)}" style="display:inline-block;padding:10px 16px;background:#16211C;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a></p>`
      + `<p style="color:#6E7A74;font-size:13px">${escapeHtml(after)}</p></div>`,
  };
}

/**
 * Gives back a tester's founding place. Only when nothing pays for it: a
 * founder with a live subscription keeps the number it was charged under.
 * The count of places is what limits new founders (`claim_founding_price`),
 * so the place is free again at once.
 */
async function releaseFoundingSeat(db: Db, restaurantId: string): Promise<boolean> {
  const { data, error } = await db.from("restaurants").update({ founding_number: null })
    .eq("id", restaurantId).not("founding_number", "is", null).is("stripe_subscription_id", null).select("id");
  if (error) throw new Error(`Founding place release failed: ${error.message}`);
  return Boolean(data?.length);
}

