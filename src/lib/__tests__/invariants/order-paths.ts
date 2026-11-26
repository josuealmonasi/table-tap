import { read, schema } from "./helpers";
import { sqlBody } from "./order-inventory";

/**
 * Every way an order comes into being, and what each must refuse first.
 *
 * The same rule kept separately on several paths, with one path missing it,
 * is how most of this app's bugs looked: coupons judged on dishes on one path
 * and on dishes plus service on another, the sitting lock on the waiter's
 * round but not the diner's pay-later. This list makes the author of a NEW
 * order path decide each precondition, and makes a precondition that quietly
 * goes missing from a listed path fail a test.
 *
 * Status per precondition:
 *   enforced      every probe must pass;
 *   expected-gap  a known hole, being fixed elsewhere: at least one probe must
 *                 FAIL, so the test goes red when the fix lands and the marker
 *                 is removed;
 *   exempt        deliberately not checked here, with the reason.
 */

export const PRECONDITIONS = [
  "notSuspended", "notClosing", "planAllows", "menuOpen", "itemAvailable",
  "standaloneDish", "pricesVerified", "stockReserved", "sittingLocked",
] as const;
export type Precondition = typeof PRECONDITIONS[number];

export interface ProbeContext { closure: Set<string> }
export interface Probe { what: string; test: (ctx: ProbeContext) => boolean }
export type Rule =
  | { status: "enforced"; probes: Probe[] }
  | { status: "expected-gap"; fixedIn: string; probes: Probe[] }
  | { status: "exempt"; why: string };

export interface OrderPath {
  id: string;
  route: string;
  /** Files in the route's import closure that create orders on this path. */
  writes: string[];
  /** Order-creating RPCs this path calls by name. */
  rpcs: string[];
  rules: Record<Precondition, Rule>;
}

/** Source text of a file the path actually reaches, or "" if it does not. */
const src = (ctx: ProbeContext, file: string) => ctx.closure.has(file) ? read(file) : "";
const has = (file: string, re: RegExp, what = `${file} matches ${re}`): Probe =>
  ({ what, test: ctx => re.test(src(ctx, file)) });
const sqlHas = (fn: string, re: RegExp, what = `${fn}() matches ${re}`): Probe =>
  ({ what, test: () => re.test(sqlBody(fn)) });
const enforced = (...probes: Probe[]): Rule => ({ status: "enforced", probes });
const exempt = (why: string): Rule => ({ status: "exempt", why });

const VERIFY_CART = "src/lib/verify-cart.ts";
const VERIFIED_LINES = "src/lib/checkout/verified-lines.ts";
/** The loop over a cart's plain (non-combo) lines in verifyCart. */
const plainLoop = (ctx: ProbeContext): string => {
  const text = src(ctx, VERIFY_CART);
  const start = text.indexOf("for (const line of plainLines)");
  return start < 0 ? "" : text.slice(start, text.indexOf("lines.push(", start));
};

/** The BEFORE INSERT trigger on `orders` that refuses every writer once a restaurant is closing. */
export const CLOSING_TRIGGER: Probe = {
  what: "orders has the closing trigger raising PT423",
  test: () => /create trigger a_guard_order_during_restaurant_closure before insert on orders/.test(schema)
    && /errcode = 'PT423'/.test(sqlBody("guard_order_during_restaurant_closure")),
};

const ITEM_AVAILABLE = [
  has(VERIFIED_LINES, /verifyCart\(/),
  { what: "verifyCart refuses an unavailable plain line or one off an open menu",
    test: (ctx: ProbeContext) => /!db\.available \|\| !isOnOpenMenu\(db\.menu_id\)/.test(plainLoop(ctx)) },
];
/** A plain line naming an extra (`is_addon`) is refused, not sold as a dish (#766). */
const STANDALONE: Rule = enforced(
  { what: "verifyCart's plain-line loop refuses db.is_addon", test: ctx => /db\.is_addon/.test(plainLoop(ctx)) },
);
const SITTING_LOCK = /from table_sessions[\s\S]*?closed_at is null[\s\S]*?for share/;

const CHECKOUT = "src/app/api/checkout/route.ts";
const WAITER = "src/app/api/table-order/route.ts";
const TILL = "src/app/api/pos/order/route.ts";
const RECOVER = "src/app/api/pos/recover/route.ts";
const INTENT = "src/lib/order-intent.ts";
const DINER_ORDER = "src/lib/checkout/diner-order.ts";
const OFFLINE = "src/lib/pos-offline.ts";
const INTAKE = "src/lib/offline-intake.ts";
const UPLOAD = "src/app/api/pos/upload/route.ts";

/** A route that reaches the offline writer but only ever queues: each precondition holds because nothing is rung. */
const QUEUE_ONLY = has(UPLOAD, /receiveOffline\(actor, body, true\)/, "pos/upload calls receiveOffline with queueOnly=true");
const queueOnly = enforced(QUEUE_ONLY, has(INTAKE, /if \(!queueOnly && /));

/** A receipt the till took offline: shared by the till's offline branch and its manager approval. */
const offlineStock = enforced(
  sqlHas("record_offline_sale", /ring_pos_sale_v2\(/),
  sqlHas("ring_pos_sale_v2", /take_stock_floor\(/, "an offline sale takes its stock down (floored at zero)"),
);

export const ORDER_PATHS: OrderPath[] = [
  {
    id: "diner checkout (card, pay-later, counter or table)",
    route: CHECKOUT, writes: [CHECKOUT, INTENT, DINER_ORDER],
    rpcs: ["create_order_intent", "create_diner_order_intent_v1", "create_diner_order_v1"],
    rules: {
      notSuspended: enforced(has(CHECKOUT, /suspensionRefusal\(restaurant\.suspended_at\)/)),
      notClosing: enforced(has(CHECKOUT, /restaurant\.closing_at/), CLOSING_TRIGGER),
      // Not frozenBlocks: a lapsed subscription never reaches the diner (plan-guard.ts).
      planAllows: enforced(has(CHECKOUT, /can\(plan\.limits, "onlineOrdering"\)/),
        has(CHECKOUT, /can\(plan\.limits, "dineIn"\)/), has(CHECKOUT, /payLaterAllowed\(/),
        has(CHECKOUT, /restaurant\.accepting_orders/)),
      menuOpen: enforced(has(CHECKOUT, /orderableNow\(/), has(CHECKOUT, /if \(closedNow\)/)),
      itemAvailable: enforced(has(CHECKOUT, /verifiedLines\(/), ...ITEM_AVAILABLE),
      standaloneDish: STANDALONE,
      pricesVerified: enforced(has(CHECKOUT, /verifiedLines\(/), has(CHECKOUT, /priceCart\(/),
        has(CHECKOUT, /reviewedTotal/)),
      stockReserved: enforced(has(CHECKOUT, /reserveStock\(/), sqlHas("create_order_intent", /reserve_stock\(/)),
      // A table order (card or pay-later) goes in under the sitting's lock
      // (#767): without a reference through create_diner_order_v1, with one
      // through create_diner_order_intent_v1. Only a counter order, which has
      // no sitting, uses the plain insert or create_order_intent.
      sittingLocked: enforced(
        has(CHECKOUT, /if \(sessionId && member\) \{\s*const inserted = await insertDinerOrder\(/),
        has(CHECKOUT, /dinerMember: sessionId && member \? member : undefined/),
        has(DINER_ORDER, /rpc\("create_diner_order_v1"/),
        has(INTENT, /input\.dinerMember\s*\?\s*await createAdminClient\(\)\.rpc\("create_diner_order_intent_v1"/),
        sqlHas("create_diner_order_v1", SITTING_LOCK),
        sqlHas("create_diner_order_intent_v1", SITTING_LOCK),
      ),
    },
  },
  {
    id: "waiter round at a table",
    route: WAITER, writes: [WAITER, INTENT], rpcs: ["create_table_order_v2", "create_table_order_intent_v2"],
    rules: {
      notSuspended: enforced(has(WAITER, /suspensionRefusal\(restaurant\.suspended_at\)/)),
      notClosing: enforced(has(WAITER, /restaurant\.closing_at/), CLOSING_TRIGGER),
      planAllows: enforced(has(WAITER, /frozenBlocks\(/), has(WAITER, /planBlocks\(actor\.restaurantId, "dineIn"\)/),
        has(WAITER, /planBlocks\(actor\.restaurantId, "waiterService"\)/)),
      menuOpen: enforced(has(WAITER, /orderableNow\(/), has(WAITER, /if \(closedNow\)/)),
      itemAvailable: enforced(has(WAITER, /verifiedLines\(/), ...ITEM_AVAILABLE),
      standaloneDish: STANDALONE,
      pricesVerified: enforced(has(WAITER, /verifiedLines\(/), has(WAITER, /priceCart\(/)),
      stockReserved: enforced(has(WAITER, /reserveStock\(/), sqlHas("create_order_intent", /reserve_stock\(/)),
      sittingLocked: enforced(has(WAITER, /openSitting:\s*true/), sqlHas("create_table_order_v2", SITTING_LOCK),
        sqlHas("create_table_order_intent_v2", SITTING_LOCK)),
    },
  },
  {
    id: "till sale (cash, card, onto an account)",
    route: TILL, writes: [TILL], rpcs: ["ring_pos_sale_v3", "ring_pos_account_v3"],
    rules: {
      notSuspended: enforced(has(TILL, /posSuspensionAnswer\(restaurant\.suspended_at/)),
      notClosing: enforced(has(TILL, /restaurant\.closing_at/), CLOSING_TRIGGER),
      planAllows: enforced(has(TILL, /frozenBlocks\(/), has(TILL, /planBlocks\(actor\.restaurantId, "pos"\)/),
        has(TILL, /planBlocks\(actor\.restaurantId, "openAccounts"\)/)),
      menuOpen: enforced(has(TILL, /orderableNow\(/), has(TILL, /if \(closedNow\)/)),
      itemAvailable: enforced(has(TILL, /verifiedLines\(/), ...ITEM_AVAILABLE),
      standaloneDish: STANDALONE,
      pricesVerified: enforced(has(TILL, /verifiedLines\(/), has(TILL, /priceCart\(/)),
      stockReserved: enforced(sqlHas("ring_pos_sale_v2", /reserve_stock\(/), sqlHas("ring_pos_account_v2", /reserve_stock\(/)),
      sittingLocked: exempt("counter sale: no table, no sitting"),
    },
  },
  {
    id: "offline receipt sent by the till on reconnect",
    route: TILL, writes: [OFFLINE], rpcs: ["record_offline_sale_v3"],
    rules: {
      // The money was already collected: a suspended restaurant queues it for a manager.
      notSuspended: enforced(has(INTAKE, /suspended_at/), has(INTAKE, /queue_offline_sale/)),
      notClosing: enforced(has(OFFLINE, /RESTAURANT_CLOSING_CODE/), CLOSING_TRIGGER),
      planAllows: enforced(has(INTAKE, /frozenBlocks\(actor\.restaurantId\)/), has(INTAKE, /planBlocks\(actor\.restaurantId, "pos"\)/)),
      menuOpen: exempt("the sale already happened; currentOfflinePrice waives closed menus by design"),
      itemAvailable: exempt("the sale already happened; currentOfflinePrice waives sold-out by design"),
      // Repriced through verifyCart, so a receipt with an extra as a plain line goes to a manager.
      standaloneDish: STANDALONE,
      pricesVerified: enforced(has(OFFLINE, /currentOfflinePrice\(/), has(OFFLINE, /sameOfflinePrice\(/),
        sqlHas("record_offline_sale_v2", /offline_pricing_revision_v1\(/)),
      stockReserved: offlineStock,
      sittingLocked: exempt("counter sale: no table, no sitting"),
    },
  },
  {
    id: "offline upload (queue only, never rings)",
    route: UPLOAD, writes: [OFFLINE], rpcs: ["record_offline_sale_v3"],
    rules: {
      notSuspended: queueOnly, notClosing: queueOnly, planAllows: queueOnly, menuOpen: queueOnly,
      itemAvailable: queueOnly, standaloneDish: queueOnly, pricesVerified: queueOnly, stockReserved: queueOnly,
      sittingLocked: exempt("counter sale: no table, no sitting"),
    },
  },
  {
    id: "manager approval of a held offline receipt",
    route: RECOVER, writes: [OFFLINE], rpcs: ["record_offline_sale_v3"],
    rules: {
      notSuspended: exempt("recovers money already collected; available after a tier ends or a suspension"),
      // The trigger lets exactly an approved queued receipt through, by design.
      notClosing: enforced(CLOSING_TRIGGER, has(OFFLINE, /RESTAURANT_CLOSING_CODE/)),
      planAllows: exempt("recovers money already collected; does not reopen the till for new sales"),
      menuOpen: exempt("the sale already happened"),
      itemAvailable: exempt("the sale already happened"),
      standaloneDish: exempt("records the receipt's own lines as collected, never sells from today's menu"),
      pricesVerified: exempt("a manager accepts the collected price; the approval and reason are recorded"),
      stockReserved: offlineStock,
      sittingLocked: exempt("counter sale: no table, no sitting"),
    },
  },
];

/**
 * Every SQL function that creates an order. entry = called by name from src;
 * internal = called only by another listed function; legacy = called by
 * nothing, kept for a deployed route during a rollout.
 */
export const ORDER_SQL: Record<string, "entry" | "internal" | "legacy"> = {
  create_order_intent: "entry",
  create_table_order_intent_v2: "entry",
  create_diner_order_intent_v1: "entry",
  create_diner_order_v1: "entry",
  create_table_order_v2: "entry",
  ring_pos_sale_v3: "entry",
  ring_pos_account_v3: "entry",
  record_offline_sale_v3: "entry",
  pos_insert_order: "internal",
  ring_pos_sale_v2: "internal",
  ring_pos_account_v2: "internal",
  record_offline_sale_v2: "internal",
  record_offline_sale: "internal",
  ring_pos_sale: "legacy",
  ring_pos_account: "legacy",
};
