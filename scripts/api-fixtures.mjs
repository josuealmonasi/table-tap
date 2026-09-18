// ============================================================================
// The data and identities `pnpm api` needs.
//
// Everything it creates carries a mark and is deleted at the end: a test that
// leaves litter in the database is the one that later looks like a bug. (It
// happened: a test order with a made-up itemId ended up looking like a fault
// calificaciones.)
// ============================================================================
import { createClient } from "@supabase/supabase-js";

export const MARK = "apicheck";

/**
 * What the part-payment case collects, in one place.
 *
 * Small, so the bill it is taken from stays open for the cases after it, and
 * an odd amount nobody would collect by hand, so teardown can find the line it
 * wrote in the log and take that away with the money.
 */
export const PART_AMOUNT = 1.23;

/** The gratuity that rides with it, so the tip path is exercised too. */
export const PART_TIP = 0.45;

/** What the ledger and the log both call that collection. */
const PART_TOTAL = (PART_AMOUNT + PART_TIP).toFixed(2);

export async function setup(env, base) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

  const cookieFor = async email => {
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    const { data, error } = await c.auth.signInWithPassword({ email, password: "demo123" });
    if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
    return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`;
  };

  const who = {
    owner: await cookieFor("demo@tabletap.dev"),
    manager: await cookieFor("demo-manager@tabletap.dev"),
    waiter: await cookieFor("demo-waiter@tabletap.dev"),
    cashier: await cookieFor("demo-cashier@tabletap.dev"),
    kitchen: await cookieFor("demo-kitchen@tabletap.dev"),
    diner: "",
  };

  const { data: restaurant } = await admin
    .from("restaurants").select("*").eq("name", "Demo Bistro").maybeSingle();
  const { data: tables } = await admin
    .from("restaurant_tables").select("id, label").eq("restaurant_id", restaurant.id);
  // A menu that is serving RIGHT NOW: active, and on no schedule. The demo has
  // a "Weekend Brunch" menu that only serves Saturday and Sunday mornings, and
  // whichever dish sorts first happened to be on it — so every route that
  // orders food answered "no longer available" and the suite failed on a
  // Tuesday for a reason that had nothing to do with the code. Which dish that
  // was depended on the last reseed, so it came and went.
  const { data: menu } = await admin
    .from("menus").select("id").eq("restaurant_id", restaurant.id)
    .eq("active", true).is("schedule", null)
    .order("sort_order").limit(1).maybeSingle();
  if (!menu) throw new Error("no unscheduled active menu to order from");
  const { data: dish } = await admin
    .from("menu_items").select("id, name, price, emoji")
    .eq("restaurant_id", restaurant.id).eq("available", true).eq("is_addon", false)
    .eq("menu_id", menu.id)
    // Ordered, so every run uses the same dish. Unordered with limit(1),
    // Postgres returns whichever row it likes and the suite quietly changes
    // what it is testing between runs.
    .order("name").limit(1).maybeSingle();
  if (!dish) throw new Error("no available dish on the serving menu");

  // One paid order and one unpaid, ours, so the demo's are left alone.
  const line = { itemId: dish.id, name: dish.name, emoji: dish.emoji ?? "🍽️", price: Number(dish.price), qty: 1, mods: {} };
  const make = async extra => {
    const { data, error } = await admin.from("orders").insert({
      restaurant_id: restaurant.id, table_label: null, table_id: null,
      items: [line], subtotal: line.price, service_fee: 0, tip: 0, tax_pct: 0,
      discount: 0, total: line.price, note: MARK, status: "received", ...extra,
    }).select("id").single();
    if (error) throw new Error(`could not create the test order: ${error.message}`);
    return data.id;
  };

  // An open table session, which is what /api/session asks for by id.
  const { data: session } = await admin
    .from("table_sessions").select("id")
    .eq("restaurant_id", restaurant.id).is("closed_at", null)
    .limit(1).maybeSingle();

  // Every sitting this restaurant already had, by id. The waiter's case places
  // an order at a table, which opens one — and deleting the order afterwards
  // leaves the sitting behind, empty, for good. It looked like it was not
  // leaking because only one sitting may be open per table, so the next run
  // reused the one the last run abandoned rather than adding another.
  const { data: sessionsBefore } = await admin
    .from("table_sessions").select("id").eq("restaurant_id", restaurant.id);

  // Which bill lines the log ALREADY held, by id, so teardown removes only the
  // ones this run writes. Settling a table logs `paid` with no order code in
  // it, which no `like` filter can tell from a real one — and the payment was
  // being cleaned up while its log line stayed, which made the NEXT run of
  // `pnpm money` report a cashier's drawer disagreeing with the ledger.
  //
  // By id and not by timestamp. The first version of this took the newest
  // `created_at` and deleted anything after it, which quietly deleted nothing
  // at all: the demo seeder spreads its history across days and some of it is
  // dated in the FUTURE, so "newer than the newest" excluded the very rows it
  // was written to catch. A high-water mark only works on data that arrives in
  // order, and seeded data does not.
  // Every entity, not only `bill`. The bill lines had to be cleaned because
  // `pnpm money` compares them against the ledger, so their absence failed the
  // next run loudly — and that loudness is the only reason they were the ones
  // being cleaned. Every other line the gate writes (a coupon minted, a dish
  // edited, an invitation sent) stayed, seven a run, quietly filling the
  // owner's activity log with a test account's work.
  const { data: logsBefore } = await admin
    .from("user_logs").select("id").eq("restaurant_id", restaurant.id);

  // How many service requests there were BEFORE, so only ours get deleted.
  const { count: serviceRequestBefore } = await admin
    .from("service_requests").select("*", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id).eq("status", "open");

  /**
   * Lend the restaurant a card reader for one case, and take it back after.
   *
   * Nothing in development has a connected Stripe account, so every route that
   * asks for one turns the caller away before running a line of its own logic
   * — and answers 409 doing it, which is the same status several of those
   * routes use for their real refusals. That is how `/api/split/pay`'s case
   * for "no such split" spent its life being answered "this restaurant cannot
   * take cards" and passing.
   *
   * The account id is a fake and the charge will fail at Stripe, which is
   * fine: everything worth testing on these routes happens before they get
   * that far.
   */
  const withCardReader = async () => {
    const { data: was } = await admin
      .from("restaurants").select("stripe_account_id, stripe_charges_enabled")
      .eq("id", restaurant.id).maybeSingle();
    await admin.from("restaurants")
      .update({ stripe_account_id: "acct_api_check", stripe_charges_enabled: true })
      .eq("id", restaurant.id);
    return async () => {
      await admin.from("restaurants").update({
        stripe_account_id: was?.stripe_account_id ?? null,
        stripe_charges_enabled: was?.stripe_charges_enabled ?? false,
      }).eq("id", restaurant.id);
    };
  };

  // A table mid-division, on a table of its own so the cases that settle the
  // others cannot disturb it. Locked, because /api/split/pay refuses anything
  // else — and with two claims: one nobody has paid, and one already paid, so
  // both of that route's refusals have something real to refuse.
  // Its own table, not a seeded one: only one sitting may be open per table,
  // and the demo's tables already have theirs. Borrowing one would either
  // collide with that index or close a sitting the other cases are using.
  const { data: splitTable } = await admin
    .from("restaurant_tables")
    .insert({ restaurant_id: restaurant.id, label: `${MARK}-split` })
    .select("id").single();
  const { data: splitSession } = await admin
    .from("table_sessions")
    .insert({ restaurant_id: restaurant.id, table_id: splitTable.id })
    .select("id").single();
  const { data: lockedSplit } = await admin
    .from("bill_splits")
    .insert({
      restaurant_id: restaurant.id, session_id: splitSession.id, shares: 2,
      amount: 2 * line.price, status: "locked", proposed_by: MARK,
      locked_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select("id").single();
  await admin.from("bill_split_claims").insert([
    { split_id: lockedSplit.id, share_no: 1, diner: `${MARK}-unpaid`, amount: line.price },
    {
      split_id: lockedSplit.id, share_no: 2, diner: `${MARK}-paid`,
      amount: line.price, paid_at: new Date().toISOString(),
    },
  ]);

  // A sale somebody paid for in notes. Cancelling one used to be impossible:
  // the route looked for a Stripe payment intent, never found one, and told
  // the owner the payment was "still settling — try again", for ever.
  const cashPaidOrder = await make({ paid: true, pay_method: "cash", status: "received" });
  // With the money actually on the ledger, so the case can check that
  // cancelling does not take it off: the cash arrived, and it stays arrived.
  await admin.from("payments").insert({
    restaurant_id: restaurant.id, order_id: cashPaidOrder, amount: line.price,
    method: "cash", actor_email: "demo@tabletap.dev", client_ref: `${MARK}-cash-${cashPaidOrder}`,
  });

  // A ticket of our own for the printer to collect, so the cases below do not
  // race the seed's or swallow one a real screen queued. Queued by the trigger
  // on `status = 'received'`, not inserted here — inserting it collides with
  // that trigger on the unique (order_id, kind).
  const printableOrder = await make({ paid: false, status: "received" });
  const { data: printJob } = await admin
    .from("print_jobs").select("id").eq("order_id", printableOrder).maybeSingle();

  return {
    admin, base, who, restaurant, dish, menu, serviceRequestBefore,
    // Read when a case asks, never snapshotted: an earlier case MINTS a new
    // token (`POST /api/print/token`), so a value captured at setup is stale
    // by the time the printer's own cases run — and a stale token is refused,
    // which looks exactly like the route being broken.
    printToken: async () => {
      const { data } = await admin
        .from("restaurants").select("print_token").eq("id", restaurant.id).maybeSingle();
      return data?.print_token ?? "";
    },
    printableOrder,
    cashPaidOrder,
    withCardReader,
    lockedSplitId: lockedSplit?.id ?? null,
    splitSessionId: splitSession?.id ?? null,
    splitTableId: splitTable.id,
    printJobId: printJob?.id ?? null,
    billLogsBefore: (logsBefore ?? []).map(l => l.id),
    sessionsBefore: (sessionsBefore ?? []).map(x => x.id),
    table: tables[0],
    sessionId: session?.id ?? null,
    paidOrder: await make({ paid: true }),
    unpaidOrder: await make({ paid: false }),
    // A bill with a table: discounts and cancellations are asked for by table.
    tableOrder: await make({ paid: false, table_id: tables[0].id, table_label: tables[0].label }),
    // A table of its own to walk out on, so writing it off does not take the
    // one the other cases are still working on — and so the case that checks
    // the table is CLEAR afterwards always has something to clear.
    walkoutTable: tables[1],
    walkoutOrder: await make({
      paid: false, status: "preparing",
      table_id: tables[1].id, table_label: tables[1].label,
    }),
  };
}

/** Everything marked goes, whatever happened to the tests. */
export async function teardown(fx) {
  const { admin, restaurant } = fx;
  await admin.from("dish_ratings").delete().in("order_id", [fx.paidOrder, fx.unpaidOrder]);
  // A collection made in parts belongs to no order, so deleting the orders
  // leaves it behind — on the table's own sitting, quietly making the table's
  // bill a peso lighter every time the suite runs, until the table reads as
  // settled and the case that collects has nothing to collect. It is found by
  // the reference the test stamped on it.
  //
  // Its log line goes with it: the two are one record of one payment and
  // `pnpm money` compares them, so removing the money and leaving the line
  // says a waiter took cash the ledger never saw. Matched narrowly — only the
  // calculator writes `collected`, and only this suite collects that amount
  // from the demo restaurant. Nothing else is touched: every other payment the
  // suite makes keeps both of its records, exactly as it always has.
  await admin.from("payments")
    .delete().eq("restaurant_id", restaurant.id).like("client_ref", `${MARK}%`);
  // And the ones written with no reference of their own. Settling a table by
  // card or cash records against the ORDER and names no collection, so the
  // filter above never saw them — the order was then deleted below,
  // `payments.order_id` is `on delete set null`, and every run left one more
  // payment in the ledger belonging to nothing at all. They were invisible to
  // `pnpm money` too, which is the half that mattered: it sorts payments into
  // attached-to-an-order and attached-to-a-sitting, and a row with neither
  // fell between the two.
  const settledHere = [
    fx.paidOrder, fx.unpaidOrder, fx.tableOrder, fx.walkoutOrder, fx.cashPaidOrder,
  ].filter(Boolean);
  if (settledHere.length) await admin.from("payments").delete().in("order_id", settledHere);
  await admin.from("user_logs").delete()
    .eq("restaurant_id", restaurant.id).eq("entity", "bill").eq("action", "collected")
    .like("detail", `%amount=${PART_TOTAL} method=cash%`);
  // Every line this run wrote: the ones that are there now and were not there
  // at setup. The ledger and the log are two records of one night and
  // `pnpm money` compares them per person and method, so removing a payment
  // without its line leaves the gate failing on the next run over money that
  // was never real.
  if (fx.billLogsBefore) {
    const kept = new Set(fx.billLogsBefore);
    const { data: logsNow } = await admin
      .from("user_logs").select("id").eq("restaurant_id", restaurant.id);
    const ours = (logsNow ?? []).map(l => l.id).filter(id => !kept.has(id));
    if (ours.length) await admin.from("user_logs").delete().in("id", ours);
  }
  // The split goes before the sitting it hangs off: claims cascade from the
  // split, the split cascades from the session, but the session itself is ours
  // and nothing else removes it.
  if (fx.lockedSplitId) await admin.from("bill_splits").delete().eq("id", fx.lockedSplitId);
  if (fx.splitSessionId) await admin.from("table_sessions").delete().eq("id", fx.splitSessionId);
  if (fx.splitTableId) await admin.from("restaurant_tables").delete().eq("id", fx.splitTableId);
  await admin.from("orders").delete().eq("note", MARK);
  // And any sitting this run opened that has nothing left in it. Only the ones
  // that were not there at setup, and only when empty: a sitting with orders on
  // it belongs to the demo's history, not to us.
  if (fx.sessionsBefore) {
    const kept = new Set(fx.sessionsBefore);
    const { data: now } = await admin
      .from("table_sessions").select("id").eq("restaurant_id", restaurant.id);
    for (const row of now ?? []) {
      if (kept.has(row.id)) continue;
      const { count } = await admin
        .from("orders").select("id", { count: "exact", head: true }).eq("session_id", row.id);
      if (!count) await admin.from("table_sessions").delete().eq("id", row.id);
    }
  }
  // Reprints queue a job against a SEEDED order, so deleting our orders does
  // not take them with it. Bounded by the unique index on (order_id, kind) —
  // which is why the count stopped at one and looked like it was not leaking —
  // but a gate that leaves a ticket in the print queue is not a clean slate.
  if (fx.printedOrders?.length) {
    await admin.from("print_jobs").delete().in("order_id", fx.printedOrders);
  }
  await admin.from("coupons").delete().eq("restaurant_id", restaurant.id).like("code", "API-%");
  // The waiter request the test creates carries a table. The filter said
  // `table_id is null` and deleted nothing: an open row was left on Table 1
  // that later showed up as a visual bug on the board. A test that leaves
  // litter is the one that later looks like a bug.
  if (fx.serviceRequestBefore !== undefined) {
    const { data: now } = await admin
      .from("service_requests").select("id")
      .eq("restaurant_id", restaurant.id).eq("status", "open")
      .order("created_at", { ascending: false });
    const extra = (now ?? []).slice(0, Math.max(0, (now ?? []).length - fx.serviceRequestBefore));
    if (extra.length) await admin.from("service_requests").delete().in("id", extra.map(x => x.id));
  }
  await admin.from("promotions").delete().eq("restaurant_id", restaurant.id).like("name", `${MARK}%`);
  await admin.from("icon_groups").delete().eq("restaurant_id", restaurant.id).like("name", `${MARK}%`);
  await admin.from("dietary_tags").delete().eq("restaurant_id", restaurant.id).like("key", `${MARK}%`);
  await admin.from("restaurant_tables").delete().eq("restaurant_id", restaurant.id).like("label", `${MARK}%`);
  await admin.from("write_off_requests").delete().eq("restaurant_id", restaurant.id).eq("note", MARK);
  // The test login: the row and the user holding it up.
  const { data: hired } = await admin.from("staff").select("user_id").eq("email", `${MARK}@tabletap.dev`).maybeSingle();
  await admin.from("staff").delete().eq("email", `${MARK}@tabletap.dev`);
  if (hired?.user_id) await admin.auth.admin.deleteUser(hired.user_id).catch(() => {});
}
