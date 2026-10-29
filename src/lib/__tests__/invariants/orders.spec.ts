import { describe, expect, it } from "vitest";
import ts from "typescript";
import { walkAll, schema, sources, read } from "./helpers";

describe("an order stores only verified choices and a validated destination", () => {
  it("keeps client mods, extras and tableLabel out of every order builder", () => {
    // An order carried free component extras, arbitrary modifier JSON and a
    // table label unrelated to its debt. Discover the writers so a new one
    // must declare how its items and destination were verified too.
    const writers = sources.filter(file => {
      const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
      let writesOrder = false;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "insert" && /\.from\("orders"\)/.test(node.expression.expression.getText(source))) {
          writesOrder = true;
        }
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === "p_order" &&
          ts.isObjectLiteralExpression(node.initializer) && node.initializer.properties.some(property =>
            ts.isPropertyAssignment(property) && property.name.getText(source) === "items")) writesOrder = true;
        ts.forEachChild(node, visit);
      };
      visit(source);
      return writesOrder;
    });
    expect(writers.sort()).toEqual([
      "src/app/api/checkout/route.ts", "src/app/api/pos/order/route.ts",
      "src/app/api/table-order/route.ts", "src/lib/pos-offline.ts",
    ]);
    for (const file of writers.filter(file => file !== "src/lib/pos-offline.ts")) {
      const code = read(file);
      expect(code, file).toMatch(/const verified = result\.lines;/);
      expect(code, file).toMatch(/(?:verifyCart|verifiedLines)\(/);
      expect(code, file).not.toMatch(/\b(?:mods|extras|table_label):\s*(?:body\.|line\.|chosen\.|tableLabel\b)/);
      if (file.includes("/checkout/")) {
        expect(code).toMatch(/const table = tableId \? await tableOf\(restaurantId, tableId\) : null;/);
        expect(code).toMatch(/checkoutOrderRow\(\{\s*restaurantId,\s*table,/);
        expect(code).not.toMatch(/\btableLabel\b/);
      } else {
        expect(code).toMatch(/items: verified/);
        if (file.includes("/table-order/")) expect(code).toMatch(/table_label: table\.label/);
        else expect(code).not.toMatch(/table_label:|tableLabel/);
      }
    }
    // A recovered sale already happened: only verified current lines, or the
    // bounded historical snapshot after manager approval, may record it.
    const offline = read("src/lib/pos-offline.ts");
    expect(offline).toContain("const savedLines = offlineLines(body.items)");
    expect(offline).toContain("const lines = approval ? savedLines : current!.lines");
    expect(offline).toMatch(/items: lines/);
    const row = read("src/lib/checkout/order-row.ts");
    expect(row).toContain("items: o.verified");
    expect(row).toContain("table_label: o.table?.label ?? null");
    for (const file of ["src/lib/verify-cart.ts", "src/lib/verify-combo.ts"]) {
      const code = read(file);
      expect(code).toMatch(/verifyModifiers\(/);
      expect(code).toMatch(/verifyExtras\(/);
      expect(code).not.toMatch(/\b(?:mods|extras):\s*(?:line|chosen|component)\.(?:mods|extras)/);
    }
    expect(read("src/app/api/service-requests/route.ts")).toContain("table_label: table.label");
    expect(read("src/hooks/useCart.ts")).toContain("removeLineExtras(line, drop)");
  });
});

describe("money that stops being owed closes the sitting", () => {
  it("closes the sitting wherever an order is marked paid or written off", () => {
    // A sitting that never closes holds its table occupied and keeps the diner
    // bound to it forever. There is no single chokepoint — a card, cash at the
    // table and a write-off are three routes to the same empty table — so each
    // one has to do it.
    // Only a route that SETTLES something: `paid: true` inside an `.update()`,
    // which is an order that was owed and now is not. A counter sale inserts a
    // row already paid, with no table and no sitting — there was never
    // anything holding a table to close. Matching the whole file rather than
    // the call is what made that look like the same act. A write-off is now
    // written by `write_off_orders` under the money lock (paths audit #5), so
    // calling it counts as settling too.
    const settlesExisting = /\.update\(\s*\{[\s\S]*?(paid:\s*true|written_off:\s*true)|(?:rpc|checkoutPageRpc)\(\s*"write_off_orders"/;
    const clearing = sources.filter(f => settlesExisting.test(read(f)));
    expect(clearing.length).toBeGreaterThan(0);

    const missing = clearing.filter(f => !/closeSession/.test(read(f)));
    expect(missing, `clears a debt without closing the sitting: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("a combo survives the trip to the server", () => {
  it("sends comboId and components with the cart", () => {
    // The checkout payload is an explicit whitelist, which is right — the
    // server has no business seeing `cartId`. But it was missing the two
    // fields that make a combo a combo, so every bundle arrived as a loose
    // line whose itemId is a promotion id. The server looked it up among the
    // dishes, found nothing, and told the diner it was no longer available.
    // Combos could not be ordered at all, and they are a paid-tier feature.
    const app = read("src/hooks/useCheckout.ts");
    expect(app.indexOf("items: orderableItems.map"), "the checkout payload moved").toBeGreaterThan(-1);
    const payload = app.slice(app.indexOf("items: orderableItems.map"));
    expect(payload.slice(0, 600)).toContain("comboId");
    expect(payload.slice(0, 600)).toContain("components");
  });
});

describe("which QR the diner came in through is never assumed", () => {
  it("hands paymentOptions a real atTable rather than a literal", () => {
    // Paying at the till is defined as "no table is holding this order", so a
    // hardcoded `atTable: true` in the caller makes that option unreachable
    // however the restaurant is configured. That shipped: an owner with
    // "pay at the end / at the counter" switched on and no Stripe account saw
    // their general QR hand the diner a cart with no button on it at all and a
    // line saying the restaurant could not take cards. Only the screen holding
    // the table knows the answer, so only it may supply it.
    const guilty: string[] = [];
    for (const file of sources) {
      for (const call of read(file).match(/paymentOptions\(\{[^}]*\}/g) ?? []) {
        if (/atTable:\s*(true|false)\b/.test(call)) guilty.push(file);
      }
    }
    expect(guilty, `decides atTable for itself: ${guilty.join(", ")}`).toEqual([]);
  });
});

describe("one order, one code", () => {
  it("builds the ORD- code in exactly one place", () => {
    // There were two. `orderCode` in types.ts strips the dashes before taking
    // four characters; `shortCode` in open-bills.ts did not. For a uuid they
    // agree — 200,000 random ones, no difference — so nothing was ever wrong
    // on screen. But a cashier searching for a bill types the code the
    // customer reads off their phone, and two functions that must agree are
    // one edit away from not.
    const builders = walkAll("src/lib")
      .concat(walkAll("src/components"))
      .filter(f => /\.tsx?$/.test(f) && !f.includes("__tests__"))
      .filter(f => /["'`]ORD-|ORD-\$\{/.test(read(f)))
      .filter(f => !f.endsWith("src/lib/types.ts"))
      // order-code.ts reads a code back into the id range it covers — the
      // inverse, not a second copy. That the two agree is asserted directly in
      // order-code.spec.ts rather than by counting files.
      .filter(f => !f.endsWith("src/lib/order-code.ts"));
    expect(
      builders,
      `These build an order code of their own. There is one in \`types.ts\`:\n${builders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a sale is handed back once", () => {
  it("cancels conditionally, so of two racing cancels only one writes a handback", () => {
    // The handback line is money: the corte takes it out of the drawer of
    // whoever took the cash. Two cancels racing on an unconditional write both
    // succeed, both log, and the sale leaves the drawer twice — while the
    // stock it held goes back on the shelf twice.
    const src = read("src/app/api/orders/cancel/route.ts");
    expect(src).toContain('checkoutPageRpc("prepare_order_refund"');
    expect(src.indexOf('data?.outcome !== "cancelled"')).toBeGreaterThan(src.indexOf('checkoutPageRpc("prepare_order_refund"'));
    expect(src.indexOf('await executeOrderRefund')).toBeGreaterThan(src.indexOf('checkoutPageRpc("prepare_order_refund"'));
    expect(src).not.toContain('action: "refunded"');
    const executor = read("src/lib/refunds/operations.ts");
    expect(executor).toContain('rpc("start_refund_attempt"');
    expect(executor).toContain('rpc("finish_refund_operation_v2"');
    expect(executor).toContain('refund_application_fee: true');
    const sql = read("supabase/schema.sql");
    expect(sql).toContain("status in ('received', 'preparing')");
    expect(sql).toContain("if not found then return false; end if;");
  });
});

describe("the board loads what the badge counts", () => {
  it("seeds the live board by status, not by the newest rows of any status", () => {
    // The newest 100 orders of every status, filtered to the live ones after
    // they arrived: after a busy stretch, an order the kitchen had not started
    // was not loaded at all — while the Pedidos badge, counting by status,
    // still counted it. The board and the badge have to agree on what "live"
    // means, and only a status can say it.
    const page = read("src/app/dashboard/orders/page.tsx");
    const at = page.indexOf('.from(kitchen ? "kitchen_tickets" : "orders")');
    expect(at, "neither role has a live feed").toBeGreaterThan(-1);
    const query = page.slice(at, page.indexOf("),", at));
    expect(query, "the board is no longer seeded by status").toMatch(/\.in\("status", LIVE_FLOW\)/);
    expect(query, "a row limit decides which live orders the kitchen sees").not.toMatch(/\.limit\(/);
  });
});

describe("a refused move is not a dropped connection", () => {
  it("queues a move for later only when the request never got an answer", () => {
    // The board threw on any non-OK answer inside the same `try` that queues
    // offline work, so a 403 from an expired sign-in was held as "saved, will
    // be sent", the ticket shown moved on this screen only, and the move sent
    // again and refused on every reconnect.
    const src = read("src/hooks/useRestaurantOrders.ts").replace(/\/\/.*$/gm, "");
    expect(src, "a refusal is thrown into the offline path").not.toMatch(/if \(!res\.ok\) throw/);
    // And a queued move the server refused is dropped, not kept for ever;
    // only a server that is failing is asked again.
    expect(src, "a refused queued move is kept and retried for ever").toMatch(/res\.status >= 500\)\s*\{?\s*stuck\.push/);
  });
});

describe("an order that could not be read is not a missing one", () => {
  it("throws from the tracker's reader when the read fails", () => {
    // `.single()` with the error dropped made a failed read null, and the
    // tracker page answered a diner who had just ordered with "not found".
    const src = read("src/lib/order-tracking.ts");
    const start = src.indexOf("export async function fetchTrackedOrder(");
    expect(start, "fetchTrackedOrder not found — the scan broke").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body, "a failed read of an order still reads as a missing order").toMatch(/if \(error\) throw/);
  });

  it("answers every route caller's failed read with a 500, never a 404", () => {
    const offenders = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => /await fetchTrackedOrder\([^)]*\);/.test(read(f)));
    expect(offenders, `a failed read that becomes "not found":\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("a customer account's orders are never a table's", () => {
  it("leaves them out of every reader of what a table owes", () => {
    // An order on an account is delivered and not paid, so `paid = false`
    // alone would put it on the table's bill as well: the table charged for a
    // dish somebody's account already owes. Every such reader says so.
    const exempt = new Set([
      // The account's own reads, which want exactly these orders.
      "src/lib/accounts-server.ts",
      // The webhook marks the orders named in Stripe's metadata; an order a
      // card checkout is open on cannot be put on an account (account_charge).
      "src/lib/checkout-settle.ts",
      // Removes the one pending order a card checkout was opened for, by id;
      // still pending_payment, so it was never put on an account.
      "src/lib/checkout-abandon.ts",
    ]);
    const missing: string[] = [];
    for (const f of sources.filter(f => !exempt.has(f))) {
      const lines = read(f).split("\n");
      lines.forEach((line, i) => {
        if (!/\.eq\("paid", false\)/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
        // Either way round: leaving the accounts out, or asking for them on
        // purpose (the corte's "still owed on accounts").
        const near = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
        if (!/\.is\("account_id", null\)|\.not\("account_id", "is", null\)/.test(near)) missing.push(`${f}:${i + 1}`);
      });
    }
    expect(missing, "a reader of unpaid orders that would bill a table for an account's food").toEqual([]);

    // The same, in the two functions that decide what a sitting owes.
    const schema = read("supabase/schema.sql");
    for (const fn of ["close_session_if_clear", "collect_on_sitting_v2"]) {
      const start = schema.indexOf(`create or replace function public.${fn}(`);
      expect(start, `${fn} is not in the schema`).toBeGreaterThan(-1);
      const body = schema.slice(start, schema.indexOf("$$;", start));
      expect(body, `${fn} counts an account's orders as the table's`).toContain("account_id is null");
    }
  });
});

describe("a sitting lasts as long in SQL as in the app", () => {
  it("writes the table-member functions' window as OPEN_BILL_HOURS", () => {
    // Two places that must agree: the routes treat a sitting older than
    // OPEN_BILL_HOURS as over, and the member functions close and refuse it by
    // their own interval. Changed in one place only, a phone would be let into
    // a sitting the bill no longer shows, or kept out of one it still owes on.
    const hours = Number(/export const OPEN_BILL_HOURS = (\d+);/.exec(read("src/lib/table-bill.ts"))?.[1]);
    expect(hours, "OPEN_BILL_HOURS moved").toBeGreaterThan(0);
    for (const name of ["request_table_member", "decide_table_member"]) {
      const start = schema.indexOf(`create or replace function public.${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      const body = schema.slice(start, schema.indexOf("$$;", schema.indexOf("$$", start) + 2));
      const intervals = [...body.matchAll(/interval '(\d+) hours'/g)].map(m => Number(m[1]));
      expect(intervals.length, `${name} has no sitting window`).toBeGreaterThan(0);
      expect(intervals.every(h => h === hours), `${name}: ${intervals}`).toBe(true);
    }
  });
});
