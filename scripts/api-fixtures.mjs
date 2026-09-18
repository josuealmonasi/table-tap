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
    printJobId: printJob?.id ?? null,
    billLogsBefore: (logsBefore ?? []).map(l => l.id),
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
  const settledHere = [fx.paidOrder, fx.unpaidOrder, fx.tableOrder, fx.walkoutOrder].filter(Boolean);
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
  await admin.from("orders").delete().eq("note", MARK);
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
