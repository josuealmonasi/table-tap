import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { walk, walkAll, read } from "./helpers";

describe("a zero platform fee is never sent to Stripe", () => {
  it("omits application_fee_amount on every card path", () => {
    // Stripe refuses an application fee of 0. Grupo charges no per-order fee,
    // and a pilot restaurant we don't bill is the same case — so a route that
    // passes the fee unconditionally works for everyone except the restaurants
    // we most want to keep happy. /api/checkout guarded it; /api/bill/pay did
    // not, and card orders would go through while paying the table's bill died.
    // The diner's checkout opens its session through `openCardSession`.
    expect(read("src/app/api/checkout/route.ts")).toMatch(/await openCardSession\(/);
    for (const file of ["src/lib/checkout/card-session.ts", "src/app/api/bill/pay/route.ts",
      "src/app/api/split/pay/route.ts", "src/app/api/account/pay/route.ts"]) {
      const body = read(file);
      const uses = body.includes("application_fee_amount");
      expect(uses, `${file} no longer sets an application fee`).toBe(true);
      expect(
        /(appFee|fee\.cents|feeCents) > 0 \? \{ application_fee_amount/.test(body),
        `${file} sends application_fee_amount even when it is zero`,
      ).toBe(true);
    }
  });
});

describe("each Stripe stream has its own endpoint and its own secret", () => {
  /**
   * The app takes money on two Stripe accounts. A diner's food is a DIRECT
   * charge on the restaurant's own account — the change that stopped Stripe
   * billing us MX$13.80 on a MX$300 ticket against MX$0.75 collected — so
   * those events fire there. A subscription is charged on ours. Stripe has no
   * endpoint that receives both, and issues a separate signing secret for each.
   *
   * The tempting shortcut is one route trying several secrets until one fits.
   * It works, and it also means the code can no longer say which account an
   * event came from: a connected-account settlement arriving on the platform
   * endpoint would be paid out identically. So: one secret per route, and each
   * route handles only its own account's events.
   */
  const PLATFORM = "src/app/api/webhooks/stripe/route.ts";
  const CONNECT = "src/app/api/webhooks/stripe/connect/route.ts";

  it("verifies each endpoint against exactly one secret", () => {
    for (const file of [PLATFORM, CONNECT]) {
      const secrets = new Set(
        [...read(file).matchAll(/process\.env\.(STRIPE_WEBHOOK_SECRET\w*)/g)].map(m => m[1]),
      );
      expect(
        [...secrets],
        `${file} should read exactly one webhook secret — trying several is how\nan endpoint stops knowing which Stripe account sent it`,
      ).toHaveLength(1);
    }

    const platformSecret = read(PLATFORM).match(/process\.env\.(STRIPE_WEBHOOK_SECRET\w*)/)?.[1];
    const connectSecret = read(CONNECT).match(/process\.env\.(STRIPE_WEBHOOK_SECRET\w*)/)?.[1];
    expect(
      platformSecret,
      "both endpoints read the same secret, so only one of them can ever verify",
    ).not.toBe(connectSecret);
  });

  it("keeps each account's events on its own endpoint", () => {
    // A subscription cannot arrive on a connected account, and a diner's
    // checkout cannot arrive on ours. Handling one on the other's route would
    // be dead code at best and a trust boundary crossed at worst.
    expect(
      read(PLATFORM).includes("checkout.session."),
      "the platform endpoint handles a connected account's checkout",
    ).toBe(false);
    expect(
      read(CONNECT).includes("customer.subscription."),
      "the connect endpoint handles our own account's subscription",
    ).toBe(false);
  });

  it("follows a restaurant's account, so card payments do not wait for the owner to open Settings", () => {
    // Whether diners may pay a restaurant by card was refreshed only on the
    // Settings screen. Stripe usually finishes reviewing an account after the
    // owner has left onboarding, and the restaurant took no cards until
    // somebody opened that screen again.
    expect(read(CONNECT).includes('"account.updated"'), "the connect endpoint ignores account.updated").toBe(true);
    expect(read(PLATFORM).includes('"account.updated"'), "a restaurant's account event handled on the platform endpoint").toBe(false);
  });
});

/**
 * A webhook Stripe delivers twice must not be money that arrived twice.
 *
 * Stripe re-sends an event whenever it is not certain the first delivery
 * landed. `checkout-settle.ts` says in its own header that every path is
 * written to survive that — "the guards are `.eq("paid", false)` and
 * `.is("paid_at", null)`" — and for a while two of its three paths had
 * neither: the row was marked paid, read back, and recorded again. The ledger,
 * the corte and the day's takings all counted one payment as two. It never bit
 * only because the webhooks had not been registered yet.
 */
describe("a repeated webhook cannot record the same money twice", () => {
  const settle = read("src/lib/checkout-settle.ts");

  it("guards every update that marks an order paid", () => {
    // Each `.update({...paid: true...})` must carry the guard that makes the
    // second delivery match nothing.
    const marks = [...settle.matchAll(/\.update\(\{[^}]*paid:\s*true[\s\S]{0,400}?(?=\n\n|;)/g)];
    expect(settle, "the split close must use the coverage transaction").toContain('rpc("close_divided_bill_v2"');
    // The rest moved into the database, and carry the same guard there: only
    // an order still unpaid is touched, only a share still unclaimed is.
    const schema = read("supabase/schema.sql");
    const body = (fn: string) => schema.slice(schema.indexOf(`function public.${fn}(`), schema.indexOf("$$;", schema.indexOf(`function public.${fn}(`)));
    expect(body("settle_card_orders_v2"), "settle_card_orders lost its paid = false guard").toMatch(/where id = any\(p_orders\)\s+and paid = false/);
    expect(body("settle_split_share_v2"), "settle_split_share lost its paid_at is null guard").toMatch(/and paid_at is null;/);
    const close = body("close_divided_bill_v2");
    expect(close).toContain("v_count <> v_split.shares");
    expect(close).toContain("public.retained_order_coverage(v_split.restaurant_id, o.id) < o.total");
    expect(close).toContain("and paid = false and written_off = false");

    const unguarded = marks
      .map(m => m[0])
      .filter(block => !/\.eq\(\s*["']paid["']\s*,\s*false\s*\)/.test(block));

    expect(
      unguarded.map(b => b.split("\n")[0]),
      "an update marks an order paid without .eq(\"paid\", false) — a repeated delivery would record the money again",
    ).toEqual([]);
  });

  it("keeps the guard under the guard", () => {
    // The next settle path somebody writes cannot get this wrong, because the
    // database will not hold the duplicate.
    expect(read("supabase/schema.sql")).toMatch(
      /create unique index if not exists payments_one_per_intent[\s\S]*?on payments \(order_id, stripe_payment_intent\)/,
    );
  });

  it("treats a refused duplicate as already recorded, not as a failure", () => {
    // Standalone receipt inserts are retired; each transactional writer owns
    // its duplicate guard and the caller receives that explicit outcome.
    expect(fs.existsSync("src/lib/payments.ts")).toBe(false);
    expect(read("supabase/schema.sql")).toContain("exception when unique_violation then");
    expect(read("src/lib/part-payment.ts")).toContain('outcome.outcome === "duplicate"');
  });

  it("adds a tip only on the delivery that settled the bill, and records it", () => {
    // A tip is ADDED to the order's tip and total, so it is the write a
    // repeated delivery does not leave as it was: the whole-table settle added
    // it on every copy of the event. And its payment was written from the
    // totals before the tip, so the ledger said MX$2.50 where Stripe took
    // MX$7.50. The tip's order is one this delivery settled, and the payment
    // for that order carries the tip.
    // All three now happen inside `settle_card_orders`, in one transaction.
    const start = settle.indexOf("async function settleBill(");
    expect(start, "settleBill not found — has the file moved?").toBeGreaterThan(-1);
    const bill = settle.slice(start, settle.indexOf("\n}\n", start));
    expect(bill, "the bill's tip is not handed to the call that records the money").toMatch(/settleCardOrders\([\s\S]*?\btip,/);
    expect(bill, "the tip is added to an order outside the database function").not.toMatch(/tip:\s*Number\(/);
    const schema = read("supabase/schema.sql");
    const at = schema.indexOf("function public.settle_card_orders_v2(");
    const fn = schema.slice(at, schema.indexOf("$$;", at));
    expect(fn, "the tip's order is not one this call settles").toMatch(/o\.id = p_tip_order and o\.id = any\(p_orders\) and o\.paid = false/);
    expect(fn, "the tip is added even when this delivery settled nothing").toMatch(/v_tip_on = any\(v_settled\)/);
    expect(fn, "the payment for the tip's order does not carry the tip").toMatch(/round\(greatest\(s\.total - public\.retained_order_coverage\(s\.restaurant_id, s\.id\), 0\) \+ case when s\.id = v_tip_on then coalesce\(p_tip, 0\) else 0 end, 2\)/);
  });
});

/**
 * Nothing is stamped on a Stripe session that its own webhook never reads.
 *
 * The metadata on a checkout session is the only thing that survives the trip
 * to Stripe and back: whatever the route writes there is all the webhook will
 * ever know about what the diner was charged for. A key written and never read
 * is a fact the app threw away — and one of them was a gratuity. A share of a
 * divided bill carried `settle_tip`, Stripe charged it, the restaurant
 * received it, and the ledger recorded the food alone. It stayed that way
 * because the key WAS read, just by the other settle path.
 *
 * So each route is checked against the one function that settles what it sent,
 * and the source is read rather than the running app, because a webhook is not
 * something a test can ring.
 */
describe("every fact sent to Stripe is read back", () => {
  const PAIRS = [
    ["src/app/api/split/pay/route.ts", "settleSplitShare"],
    ["src/app/api/bill/pay/route.ts", "settleBill"],
    // The diner's checkout writes its session in `openCardSession`.
    ["src/lib/checkout/card-session.ts", "settleOrder"],
  ] as const;

  /** Keys of every `metadata: { ... }` object in a file, nesting and all. */
  function keysWritten(file: string): string[] {
    const source = read(file);
    const keys = new Set<string>();
    for (const at of [...source.matchAll(/metadata:\s*\{/g)]) {
      let depth = 1;
      let i = (at.index ?? 0) + at[0].length;
      const from = i;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }
      for (const pair of source.slice(from, i).matchAll(/(?:^|[{,])\s*([a-z_]+):/g)) {
        keys.add(pair[1]);
      }
    }
    return [...keys];
  }

  /** One function's body, by name, up to the line that closes it. */
  function bodyOf(source: string, name: string): string {
    const at = source.indexOf(`function ${name}(`);
    expect(at, `checkout-settle no longer has ${name}`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", at);
    return source.slice(at, end === -1 ? source.length : end);
  }

  it("is read by the function that settles it", () => {
    const settle = read("src/lib/checkout-settle.ts");
    // What `settleCheckout` reads before it dispatches — our fee's ledger row —
    // is read for every shape, so it counts as read by each.
    const everyShape = bodyOf(settle, "settleCheckout");
    const orphans: string[] = [];
    for (const [route, fn] of PAIRS) {
      // Frozen coupon metadata is consumed under the receipt transaction's lock.
      const couponSql = fn === "settleBill"
        ? read("supabase/schema.sql").split("create or replace function public.settle_card_orders_v2(")[1]?.split("$$;")[0] ?? "" : "";
      const quoteSql = fn === "settleBill"
        ? read("supabase/schema.sql").split("create or replace function public.diner_checkout_open(")[1]?.split("$$;")[0] ?? "" : "";
      const body = bodyOf(settle, fn) + everyShape + couponSql + quoteSql;
      // A file that writes no metadata would pass this by saying nothing.
      expect(keysWritten(route).length, `${route} writes no Stripe metadata — has the session moved?`).toBeGreaterThan(0);
      for (const key of keysWritten(route)) {
        if (!body.includes(key)) orphans.push(`${route} writes ${key}, ${fn} never reads it`);
      }
    }
    expect(
      orphans,
      `a checkout session carries something its own webhook throws away:\n${orphans.join("\n")}`,
    ).toEqual([]);
  });
});

describe("Stripe's limits are respected where we build its payloads", () => {
  it("never joins an unbounded list into one metadata value", () => {
    // A metadata value stops at 500 characters, which is fourteen order ids.
    // `settle_order_ids: ids.join(",")` fitted a table of thirteen and made
    // the fourteenth unable to pay by card at all.
    const offenders = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => /settle_order_ids:\s*[^\n]*\.join\(/.test(read(f)));
    expect(
      offenders,
      `These build a metadata value by joining a list, which Stripe refuses\n` +
        `past 500 characters. Use \`packOrderIds\`:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("connects restaurants to Stripe the way it charges them", () => {
    // Diners are charged directly on the restaurant's account. Connect once
    // still asked for the `recipient` configuration a destination charge needs,
    // and waited on its transfers before offering cards: Stripe refused the
    // account outright, and nobody could connect.
    for (const route of ["src/lib/checkout/card-session.ts", "src/app/api/bill/pay/route.ts", "src/app/api/split/pay/route.ts"]) {
      expect(read(route), `${route} no longer charges on the restaurant's own account`).toMatch(/stripeAccount/);
    }
    const connect = read("src/lib/stripe-connect.ts").split("\n").filter(l => !l.trimStart().startsWith("//")).join("\n");
    expect(connect, "Connect asks for a configuration direct charges do not use").not.toMatch(/recipient|stripe_transfers/);
    expect(connect, "cards are no longer decided by card_payments").toMatch(/card_payments\?\.status/);
  });

  it("prices and opens a sale the same way at the till and on a phone", () => {
    // The till had its own copy of "which menus are serving now" and its own
    // fetch of the dishes it prices. Two copies are two answers waiting to
    // happen: a dish one price at the counter and another on a phone, or a
    // menu closed for diners that the till could still ring.
    for (const route of ["src/app/api/checkout/route.ts", "src/app/api/pos/order/route.ts"]) {
      const src = read(route);
      expect(src, `${route} no longer prices the cart with verifiedLines`).toMatch(/await verifiedLines\(/);
      expect(src, `${route} no longer asks orderableNow which menus are open`).toMatch(/await orderableNow\(/);
      expect(src, `${route} decides open menus by itself again`).not.toMatch(/openMenuIds\(/);
      expect(src, `${route} fetches the dishes it prices by itself again`).not.toMatch(/from\("menu_items"\)/);
    }
  });

  it("caps the card cart below Stripe's line-item ceiling", () => {
    // Checkout emits one line item per cart line plus the service charge and
    // the tip, and Stripe Checkout takes 100 of them.
    const checkout = read("src/app/api/checkout/route.ts");
    expect(
      checkout.includes("MAX_CARD_CART_LINES"),
      "checkout must cap the cart at the card path's own limit, not the general one",
    ).toBe(true);
  });

  it("trims the Stripe product names that carry a value from the database", () => {
    // Dish names and restaurant names are written from the browser under RLS
    // with no column cap, and Stripe refuses a product name over 250. The
    // fixed labels beside them — "Tip", "Service charge (10%)" — are bounded
    // by the code that writes them and are deliberately not the subject here.
// Two ways this regex lied before it worked. `[^}\n]` and not `[^}]`,
    // because a class that allows newlines walks off the end of the line and
    // finds a `${}` several lines below. And the "not already wrapped" test
    // covers the whole rest of the line: put after `\\s*`, it is checked at a
    // position `\\s*` can reach by matching nothing, so it passed on the space
    // and the call it was meant to exclude sailed through. Both versions
    // accused two call sites that were already correct.
    const risky =
      /\bname:(?![^\n]*stripeProductName)[^\n]*\$\{[^}\n]*\b(?:restaurant\.name|v\.name)\b/;
    // The routes, and the checkout's own line items, which a route builds through.
    const offenders = [...walkAll("src/app/api").filter(f => f.endsWith("route.ts")), ...walkAll("src/lib/checkout")]
      .filter(f => risky.test(read(f)));
    expect(read("src/lib/checkout/line-items.ts"), "the dish name reaches Stripe untrimmed").toMatch(/name: stripeProductName\(/);
    expect(
      offenders,
      `These interpolate a name out of the database into a Stripe product name\n` +
        `without trimming it to 250 characters:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a diner pays by card, and only by card", () => {
  it("names card as the only payment method on every diner checkout", () => {
    // Left to the restaurant's Stripe defaults, Checkout offers OXXO: a voucher
    // paid days later completes the session unpaid, `settleCheckout` ignores
    // it, and no handler records the money when it lands. A diner's meal is
    // paid at the table, by card.
    const sessions = walk("src").filter(f => /checkout\.sessions\.create\(|await openDinerAttempt\(/.test(read(f)) && !f.endsWith("/diner-attempt.ts") && !f.includes("/billing/") && !/mode:\s*"subscription"/.test(read(f)));
    expect(sessions.length, "the scan found no diner checkout").toBeGreaterThanOrEqual(4);
    expect(sessions.filter(f => !/payment_method_types: \["card"\]/.test(read(f))), "a diner checkout that lets Stripe choose the payment method").toEqual([]);
  });
});
