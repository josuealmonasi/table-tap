import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { walk, walkAll, read, callBody } from "./helpers";

describe("a price reads the same everywhere", () => {
  it("does not depend on the machine's locale", async () => {
    // The bug this pins: `Intl.NumberFormat(undefined, …)` gave the server one
    // string and the browser another, so every price on the menu was a
    // hydration mismatch and React re-rendered the entire customer page.
    const { formatMoney } = await import("@/lib/format");
    expect(formatMoney(23, "MXN")).toBe("MX$23.00");
    expect(formatMoney(14.9, "USD")).toBe("$14.90");
  });
});

describe("cash names the person who took it", () => {
  /**
   * Card money can arrive with nobody standing there — a diner pays online and
   * the webhook records it, so `actor_email` is null and that is correct. Cash
   * cannot: somebody physically took it, and the corte they sign at the end of
   * the night is grouped by exactly that column. A cash payment recorded
   * without an actor is money in a drawer that belongs to no drawer.
   *
   * `pnpm money` checks the rows; this checks the code that writes them, so a
   * new settlement route cannot ship the hole and wait to be noticed in data.
   */
  it("passes actorEmail wherever a payment might not be a card", () => {
    const offenders: string[] = [];

    for (const file of walkAll("src/app/api").filter(f => f.endsWith("route.ts"))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/recordPayments?\s*\(/g)) {
        const call = callBody(src, m.index + m[0].length);
        // A call that hard-codes "card" is the online path and needs no actor.
        if (/method:\s*"card"(\s+as\s+const)?\s*,/.test(call)) continue;
        if (/actorEmail:/.test(call)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${file}:${line}`);
      }
    }

    expect(
      offenders,
      `a payment that could be cash is recorded with nobody named — pass actorEmail,\nor hard-code method: "card" if it can only ever be an online payment:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * The rule that rounds money lives in one file.
 *
 * It was written out eleven times — pricing, table-bill, till, corte,
 * promotions, plan and five more. All eleven agreed, so nothing was wrong;
 * but a cent of disagreement between the cart and the bill is the kind of
 * thing nobody notices until a diner does.
 */
describe("money is rounded in one place", () => {
  it("has no second copy of round2", () => {
    const copies = walkAll("src")
      .filter(f => /\.tsx?$/.test(f) && f !== "src/lib/money.ts" && !f.includes("__tests__"))
      .filter(f => /(function|const)\s+round2\b/.test(read(f)));
    expect(
      copies,
      `round2 is defined outside src/lib/money.ts — import it instead:\n${copies.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * Money that arrives is written down.
 *
 * `orders.paid` and the `payments` ledger are two records of one fact, which is
 * the shape of every bug this app has had. `pnpm money` catches them drifting
 * in the data; this catches the cause — a route that marks an order paid and
 * forgets to say who paid what.
 *
 * Looking for a CALL rather than the name, because an import line alone would
 * satisfy a substring check long after somebody deleted the call beneath it.
 */
describe("every route that settles an order records the payment", () => {
  const SETTLES = [
    ["src/app/api/table-payment/route.ts", "the till stopped recording what it took"],
    // Every centavo here is recorded as it is collected; the pass that marks
    // the orders paid at the end deliberately records nothing, because the
    // money is already in the ledger under its own collection.
    ["src/lib/part-payment.ts", "a bill settled in parts records none of it"],
    ["src/lib/checkout-settle.ts", "a card payment is no longer written to the ledger"],
    ["src/app/api/pos/order/route.ts", "a counter sale is no longer written to the ledger"],
  ] as const;

  it("calls recordPayment wherever it sets paid", () => {
    for (const [file, complaint] of SETTLES) {
      const lines = read(file).split("\n").filter(l => !l.trimStart().startsWith("import"));
      const marksPaid = lines.filter(l => /paid:\s*true|"ring_pos_sale_v2"|"settle_(orders|card_orders|sale)_v2"|"close_divided_bill_v2"/.test(l)).length;
      // `recordPayment`, or the SQL that does the same job under a lock. The
      // calculator moved to `collect_on_sitting` so that reading the balance,
      // capping against it and inserting happen atomically — two waiters on
      // one table had been taking MX$400 for a MX$200 bill. It is still a
      // route that settles orders and still has to record the money; this
      // invariant just had to learn the second spelling.
      const records = lines.filter(
        l => /\brecordPayments?\s*\(/.test(l) || /collect_on_sitting|"ring_pos_sale_v2"|"settle_(orders|card_orders|split_share|sale)_v2"/.test(l),
      ).length;
      expect(marksPaid, `${file}: nothing marks an order paid any more`).toBeGreaterThan(0);
      expect(records, `${file}: ${complaint}`).toBeGreaterThan(0);
    }
  });

  it("settles a table in person as one write, never as two", () => {
    // "Pagó en efectivo" marked the orders paid and then wrote the ledger. A
    // failed second write left a bill paid with no money behind it, and no
    // retry could repair it: every path guards on `paid = false`.
    for (const file of ["src/app/api/table-payment/route.ts", "src/lib/part-payment.ts"]) {
      const src = read(file);
      expect(src, `${file} no longer settles through settle_orders`).toMatch(/(?:rpc|checkoutPageRpc)\("settle_orders_v2"/);
      expect(src, `${file} marks orders paid outside settle_orders`).not.toMatch(/paid:\s*true/);
    }
    // ...and the function does both under one transaction, refusing a bill that changed.
    const schema = read("supabase/schema.sql");
    const fn = schema.slice(schema.indexOf("function public.settle_orders_v2("), schema.indexOf("$$;", schema.indexOf("function public.settle_orders_v2(")));
    expect(fn).toMatch(/update orders\s+set paid = true/);
    expect(fn).toMatch(/insert into payments/);
    expect(fn).toMatch(/if v_count <> cardinality\(p_orders\) then\s+raise exception 'not_owed'/);
    expect(schema).toMatch(/grant execute on function public\.settle_orders_v2\([^)]*\)\s+to service_role;/);
  });

  it("records a card payment with the orders it paid, never after them", () => {
    // The webhook marked the orders paid, then wrote the ledger; a share was
    // claimed, then recorded. A failed second write left the diner's money
    // recorded nowhere, and Stripe's repeat found nothing left to do.
    // The webhook's settling, wherever it was split to.
    const src = ["checkout-settle.ts", "card-settle.ts", "checkout-abandon.ts"].map(f => read(`src/lib/${f}`)).join("\n");
    expect(src).toMatch(/rpc\("settle_card_orders_v2"/);
    expect(src).toMatch(/rpc\("settle_split_share_v2"/);
    expect(src, "the webhook writes the ledger outside the functions").not.toMatch(/recordPayments?\(|from\("payments"\)/);
    const schema = read("supabase/schema.sql");
    for (const fn of ["settle_card_orders_v2", "settle_split_share_v2"]) {
      const at = schema.indexOf(`function public.${fn}(`);
      const body = schema.slice(at, schema.indexOf("$$;", at));
      expect(body, `${fn} no longer records the money`).toMatch(/insert into payments/);
      expect(schema).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to service_role;`));
    }
  });

  it("rings a sale and records its money as one write", () => {
    // The till inserted the order paid and then wrote the ledger: a failed
    // second write was a sale with no money in the corte.
    const src = read("src/app/api/pos/order/route.ts");
    expect(src).toMatch(/rpc\("ring_pos_sale_v2"/);
    expect(src, "the till marks a sale paid outside settle_sale").not.toMatch(/paid:\s*true/);
    expect(src, "the till writes the ledger outside settle_sale").not.toMatch(/recordPayments?\(/);
    expect(src, "the till inserts outside its transaction").not.toMatch(/\.insert\(/);
    const offline = read("src/lib/pos-offline.ts");
    expect(offline).toMatch(/rpc\("record_offline_sale"/);
    expect(offline, "offline stock is still a second request").not.toMatch(/rpc\("take_stock_floor"/);
    const schema = read("supabase/schema.sql");
    expect(schema).toContain("v_ticket := public.ring_pos_sale_v2(p_restaurant");
    const at = schema.indexOf("function public.settle_sale_v2(");
    const fn = schema.slice(at, schema.indexOf("$$;", at));
    expect(fn).toMatch(/and status = 'pending_payment'/);
    expect(fn).toMatch(/insert into payments/);
    const ringAt = schema.indexOf("function public.ring_pos_sale_v2(");
    const ring = schema.slice(ringAt, schema.indexOf("$$;", ringAt));
    for (const operation of ["pos_ticket", "pos_insert_order", "settle_sale_v2", "settle_offline_sale_v2", "take_stock_floor", "reserve_stock"]) {
      expect(ring, `the till transaction lost ${operation}`).toContain(`public.${operation}(`);
    }
    const accountAt = schema.indexOf("function public.ring_pos_account_v2(");
    const account = schema.slice(accountAt, schema.indexOf("$$;", accountAt));
    expect(account).toContain("public.account_charge_v2(");
    expect(account).toContain("exception when sqlstate 'PT001'");
  });

  it("keeps a card payment for a customer account already collected as a refund due, never in the ledger", () => {
    // The same double charge as a table's, on a customer account: the webhook
    // arrived after the hold ran out and the till had collected the tab. It was
    // recorded as a payment against food already paid, and nobody was told.
    const schema = read("supabase/schema.sql");
    const at = schema.indexOf("function public.account_checkout_settle_v2(");
    const fn = schema.slice(at, schema.indexOf("$$;", at));
    expect(fn, "the payment is still the whole checkout, whatever was paid meanwhile").not.toMatch(/v_checkout\.amount \+ v_checkout\.tip,\s*v_checkout\.tip, 'card'/);
    expect(fn, "a double charge is not kept").toMatch(/insert into refunds_due/);
    expect(fn, "nobody is told about a double charge").toMatch(/insert into notifications[\s\S]*'refund_due'/);
    expect(fn, "a repeat of the event would flag it again").toMatch(/on conflict \(stripe_payment_intent\) do nothing/);
  });

  it("keeps a card payment that landed on a settled bill as a refund due, never drops it", () => {
    // A waiter took cash while the diner was on Stripe's page; the webhook
    // matched nothing and the card money was recorded nowhere.
    const schema = read("supabase/schema.sql");
    const at = schema.indexOf("function public.settle_card_orders_v2(");
    const fn = schema.slice(at, schema.indexOf("$$;", at));
    expect(fn, "a double charge is no longer kept").toMatch(/insert into refunds_due/);
    expect(fn, "nobody is told about a double charge").toMatch(/insert into notifications[\s\S]*'refund_due'/);
    expect(fn, "a repeat of the event would flag it again").toMatch(/on conflict \(stripe_payment_intent\) do nothing/);
    expect(fn, "the refund is not reduced by what was recorded under the payment").toMatch(/v_owed := round\(p_charged - v_recorded, 2\)/);
    // Out of the ledger: every reader of `payments` would count it as the table's.
    expect(fn).not.toMatch(/insert into payments[^;]*refund/);
    expect(schema).toMatch(/revoke all on refunds_due from anon;/);
    expect(schema).toMatch(/alter table refunds_due enable row level security;/);
    // The webhook says what Stripe charged, or nothing can be compared.
    expect(read("src/lib/card-settle.ts")).toMatch(/p_charged:/);
  });

  it("takes the table-shaping privileges from every table, after the last one is made", () => {
    // RLS does not guard TRUNCATE. The revoke near the top of the schema only
    // reached tables that existed when it ran, so refunds_due reached
    // production with TRUNCATE for every signed-in account.
    const schema = read("supabase/schema.sql");
    const revoke = "revoke truncate, references, trigger on all tables in schema public from authenticated;";
    const lastTable = schema.lastIndexOf("create table if not exists");
    expect(schema.lastIndexOf(revoke), "no revoke runs after the last table is created").toBeGreaterThan(lastTable);
  });

  it("has no other route marking an order paid on the quiet", () => {
    const known = new Set<string>(SETTLES.map(([f]) => f));
    const rogue = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts") && !known.has(f))
      .filter(f => /paid:\s*true/.test(read(f)));
    expect(
      rogue,
      `A route settles orders without recording the money. Add recordPayment, and add it to the list above:\n${rogue.join("\n")}`,
    ).toEqual([]);
  });
});

describe("no screen offers a refund the till cannot give", () => {
  it("words the offer from the plan the cancel itself will follow", () => {
    // The cancel dialog said "Cancel & refund MX$100" for any paid order. On a
    // cash sale, a card charged on the restaurant's own terminal, or an order
    // of a table's bill paid online in one go, the route could not refund it
    // and answered "payment is still settling — try again", which would never
    // once become true. The screen promised and the server refused, which is
    // this app's oldest bug shape.
    //
    // Two places guessing from `pay_method` agreed only about cash. Now there
    // is one place: the route's GET and POST both read the plan through
    // `readCancel`, and the board words its offer from what the GET answers.
    const board = read("src/components/dashboard/OrdersBoard.tsx");
    const cancel = board.slice(board.indexOf("async function handleCancel"));
    // Code only: the comment explaining why it must not read pay_method names it.
    const code = (src: string) => src.replace(/\/\/.*$/gm, "");
    const handler = code(cancel.slice(0, cancel.indexOf("\n  }\n") + 4));
    expect(handler, "the dialog no longer asks the server what the cancel will do").toMatch(/cancelPlanFor\(/);
    expect(handler, "the dialog no longer words its offer from that answer").toMatch(/cancelWording\(/);
    expect(handler, "the dialog guesses from pay_method again").not.toMatch(/pay_method/);

    const route = read("src/app/api/orders/cancel/route.ts");
    const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    const post = code(route.slice(route.indexOf("export async function POST")));
    expect(get, "GET does not read the plan the POST follows").toMatch(/readCancel\(/);
    expect(post, "POST does not follow the plan the GET described").toMatch(/readCancel\(/);
    expect(post, "POST decides for itself how the money came in").not.toMatch(/pay_method/);
  });
});

describe("a guard on money fails closed", () => {
  // `staffOpenedBill` refuses a card while a waiter collects the same food,
  // `splitInProgress` refuses the whole bill while its shares are collected.
  // Both read the database and dropped the error, so a failed read answered
  // "no" — the one answer that lets the charge through.
  const GUARDS: [string, string][] = [
    ["src/lib/table-session.ts", "staffOpenedBill"],
    ["src/lib/split-service.ts", "splitInProgress"],
  ];

  it("checks the error of every read a guard makes", () => {
    const offenders: string[] = [];
    for (const [file, name] of GUARDS) {
      const src = read(file);
      const start = src.indexOf(`export async function ${name}(`);
      expect(start, `${name} not found in ${file} — the scan broke`).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n}\n", start));
      const queries = (body.match(/await db\b/g) ?? []).length;
      const checked = (body.match(/if \(\w*[eE]rror\) throw/g) ?? []).length;
      if (queries === 0 || checked < queries) offenders.push(`${name}: ${queries} read(s), ${checked} checked`);
    }
    expect(offenders, `a money guard that can answer "no" by failing:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("refuses at every call site where the guard cannot answer", () => {
    // A throw outside the route's try is a bare 500 with no sentence; each
    // caller turns it into the same refusal the orders read gives.
    const offenders: string[] = [];
    for (const file of walkAll("src/app/api").filter(f => f.endsWith("route.ts"))) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const [, name] of GUARDS) {
        if (new RegExp(`if \\(await ${name}\\(`).test(code)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders, `a guard whose failure becomes a bare 500:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("every fee we charge is in the ledger", () => {
  it("sends Stripe no application fee without the ledger row that reserved it", () => {
    // The month's ceiling is read from `platform_fees`, one row per charge,
    // reserved before Stripe is asked. A session carrying our fee without its
    // `fee_id` is a fee the ceiling never saw: the webhook cannot take it, so
    // the month counts short — the one way to charge a restaurant past it.
    const charging = walk("src").filter(f => /application_fee_amount/.test(read(f)));
    expect(charging.length, "the scan found no Stripe session carrying our fee").toBeGreaterThanOrEqual(4);
    // `feeMetadata` is the one thing that writes `fee_id` onto a session.
    expect(charging.filter(f => !/fee_id|feeMetadata\(/.test(read(f))), "a Stripe session charges our fee without its ledger row").toEqual([]);
  });
});
