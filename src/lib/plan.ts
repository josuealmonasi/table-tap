import { round2 } from "@/lib/money";
/**
 * What a restaurant's subscription tier allows.
 *
 * Pure, like pricing.ts: the numbers arrive from `plan_limits` (one row per
 * tier, seeded in schema.sql) and this file only decides what they mean. The
 * database keeps the numbers because the triggers that enforce them read the
 * same rows — a limit written in two places is a limit that drifts.
 */

export type PlanName = "carta" | "caja" | "servicio" | "casa" | "grupo";

/**
 * Billing health, which is not the same question as which tier they are on.
 *
 * `locked` freezes the dashboard and nothing else. The diner's menu keeps
 * serving and keeps taking orders: a card that bounced on Friday must not
 * close the restaurant on Saturday, and the diner never agreed to anything.
 */
export type PlanStatus = "trialing" | "active" | "past_due" | "locked";

/** One row of `plan_limits`. A null ceiling means unlimited. */
export interface PlanLimits {
  plan: PlanName;
  rank: number;
  monthly_price: number;
  /** What the plan costs once the launch offer ends; null when there is none. */
  list_price?: number | null;
  /** The most we take in per-order fees in one month; null for no ceiling. */
  fee_cap?: number | null;
  /** Flat platform fee per CARD order, in the restaurant's currency. */
  order_fee: number;
  max_tables: number | null;
  max_staff: number | null;
  max_menus: number | null;
  max_items: number | null;
  allows_dine_in: boolean;
  allows_menu_schedules?: boolean;
  /** Taking the food before paying — at the table or at the till. Paid plans only. */
  allows_deferred_payment?: boolean;
  allows_promotions: boolean;
  allows_coupons: boolean;
  /** Counting stock, and the low-stock warnings that come with it. Paid only. */
  allows_inventory?: boolean;
  allows_pos?: boolean;
  allows_waiter_service?: boolean;
  /** The visit card diners save and staff stamp. Every paid tier. */
  allows_loyalty?: boolean;
  /**
   * Ordering from the diner's phone. Every tier but Caja, which is the
   * register on its own: its diners read the menu and order at the till.
   */
  allows_online_ordering?: boolean;
  /** The kitchen board a sale goes to once it is paid. Every tier but Caja. */
  allows_kitchen_board?: boolean;
  /** Customer accounts: food now, paid later in one go. Every paid tier. */
  allows_open_accounts?: boolean;
  allows_staff_discounts: boolean;
  analytics_days: number;
  log_days: number;
  /** A real Stripe Price, once the tier has one; checkout falls back to
   *  monthly_price so a tier is buyable with no setup in Stripe. */
  stripe_price_id?: string | null;
}

export type PlanFeature =
  | "dineIn"
  | "promotions"
  | "coupons"
  | "staffDiscounts"
  | "menuSchedules"
  | "deferredPayment"
  | "inventory"
  | "pos"
  | "waiterService"
  | "loyalty"
  | "onlineOrdering"
  | "kitchenBoard"
  | "openAccounts";

const FEATURE_COLUMN: Record<PlanFeature, keyof PlanLimits> = {
  dineIn: "allows_dine_in",
  waiterService: "allows_waiter_service",
  promotions: "allows_promotions",
  coupons: "allows_coupons",
  staffDiscounts: "allows_staff_discounts",
  menuSchedules: "allows_menu_schedules",
  deferredPayment: "allows_deferred_payment",
  inventory: "allows_inventory",
  pos: "allows_pos",
  loyalty: "allows_loyalty",
  onlineOrdering: "allows_online_ordering",
  kitchenBoard: "allows_kitchen_board",
  openAccounts: "allows_open_accounts",
};

/**
 * The features every tier had before Caja, which the columns default to on.
 * A row read before the column existed, or a test's plan that never mentions
 * it, means what it always meant: diners order from their phone, and a sale
 * goes to the kitchen.
 */
const ON_UNLESS_SAID: PlanFeature[] = ["onlineOrdering", "kitchenBoard"];

/** Whether this tier includes a feature at all. */
export function can(limits: PlanLimits, feature: PlanFeature): boolean {
  const value = limits[FEATURE_COLUMN[feature]];
  return ON_UNLESS_SAID.includes(feature) ? value !== false : value === true;
}

/**
 * Whether `plan` keeps everything `current` has.
 *
 * The ladder used to be a line — each tier everything below it and more — so
 * "the next one up" was simply the next rank. Caja broke that on purpose: it
 * is the register without the diner's phone, so it sits above Carta in price
 * and below it in one thing. A tier is only an upgrade if nothing the
 * restaurant already has would be taken away.
 */
export function keepsEverything(plan: PlanLimits, current: PlanLimits): boolean {
  return (Object.keys(FEATURE_COLUMN) as PlanFeature[]).every(f => !can(current, f) || can(plan, f));
}

/** How many more may be created; null when the ceiling is unlimited. */
export function remaining(used: number, max: number | null): number | null {
  if (max === null) return null;
  return Math.max(0, max - used);
}

/**
 * Whether one more would fit.
 *
 * Asked before every create, so it answers about the NEXT one rather than the
 * current count — a plan allowing 25 tables should refuse the 26th, not the
 * 25th.
 */
export function hasRoom(used: number, max: number | null): boolean {
  if (max === null) return true;
  return used < max;
}

/**
 * Whether owner-side writes are frozen.
 *
 * Deliberately not a question about features: everything the diner touches
 * carries on working while a subscription is being sorted out.
 */
export function dashboardFrozen(status: PlanStatus): boolean {
  return status === "locked";
}

/**
 * The platform's cut of one card order, in cents, for the Stripe application
 * fee. A flat amount, not a percentage: what this costs to run, and what it is
 * worth, barely change with the price of the wine.
 *
 * Capped at a tenth of the order, because flat and small stop being the same
 * thing on a small ticket — MX$3 off a MX$20 coffee is not a fee, it is a
 * share of the coffee. Stripe also refuses an application fee larger than the
 * charge, and a cap is a better answer than a failed payment.
 */
export const FEE_CAP_FRACTION = 0.1;

export function orderFeeCents(
  limits: PlanLimits,
  totalCents: number,
  /** What we have already taken in fees this month, in cents. */
  chargedThisMonthCents = 0,
): number {
  if (limits.order_fee <= 0 || totalCents <= 0) return 0;
  const flat = Math.round(limits.order_fee * 100);
  const perOrder = Math.min(flat, Math.floor(totalCents * FEE_CAP_FRACTION));

  // And a ceiling for the month. Past it we stop charging: a restaurant that
  // has a good month should not be handed a bill it never agreed to, and
  // "never more than X" is a promise that fits on the plan card.
  if (limits.fee_cap === null || limits.fee_cap === undefined) return perOrder;
  const left = Math.round(limits.fee_cap * 100) - chargedThisMonthCents;
  return Math.max(0, Math.min(perOrder, left));
}

/**
 * Whole days left of a trial — 0 once it has passed, and 0 when there is no
 * trial at all, so a caller can treat "no days left" as one case.
 *
 * Rounded up, because a trial with four hours left is still a trial and
 * showing "0 days left" on a screen someone can still use reads as a bug.
 */
export function trialDaysLeft(trialEndsAt: string | null, now: Date = new Date()): number {
  if (!trialEndsAt) return 0;
  const ms = new Date(trialEndsAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/** On a launch price, and by how much — for showing what it will cost later. */
export function launchSaving(limits: PlanLimits): number {
  const list = limits.list_price ?? 0;
  return list > limits.monthly_price ? round2(list - limits.monthly_price) : 0;
}

/**
 * The tier's name as it is written to people.
 *
 * The four are brand names, not words — Carta, Servicio, Casa, Grupo read the
 * same in both catalogs, so they are capitalised rather than translated.
 */
export function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** The row for a plan, or undefined if the catalog doesn't have it. */
export function planFor(all: PlanLimits[], plan: PlanName): PlanLimits | undefined {
  return all.find(p => p.plan === plan);
}

/** The next tier up — what an upgrade prompt should offer. Undefined at the top. */
export function nextPlan(all: PlanLimits[], plan: PlanName): PlanLimits | undefined {
  const current = planFor(all, plan);
  if (!current) return undefined;
  return [...all]
    .filter(p => p.rank > current.rank && keepsEverything(p, current))
    .sort((a, b) => a.rank - b.rank)[0];
}

/**
 * The cheapest tier that includes a feature — what a lock should name.
 *
 * "Upgrade to unlock" is a worse answer than "coupons come with Casa": the
 * owner can decide without opening a pricing page.
 */
export function cheapestWith(
  all: PlanLimits[],
  feature: PlanFeature,
  /** The restaurant's own tier: a lock never names one that would take away what it has. */
  current?: PlanLimits,
): PlanLimits | undefined {
  return [...all]
    .filter(p => can(p, feature) && (!current || keepsEverything(p, current)))
    .sort((a, b) => a.rank - b.rank)[0];
}

/** Every role a login can have, in the order the team screen lists them. */
export const TEAM_ROLES = ["kitchen", "waiter", "cashier", "manager", "owner"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/**
 * The roles a restaurant on this tier can hand out.
 *
 * A cook works the kitchen board and a waiter the tables; a tier with no
 * kitchen board (Caja) has neither screen, so a login for either would sign
 * in to nothing. The team screen offers only these, and the route refuses the
 * rest — the same list on both sides.
 */
export function assignableRoles(limits: PlanLimits | null | undefined): TeamRole[] {
  if (!limits || can(limits, "kitchenBoard")) return [...TEAM_ROLES];
  return TEAM_ROLES.filter(r => r !== "kitchen" && r !== "waiter");
}
