// ============================================================================
// TableTap — attacking the routes that move money.
//
//   pnpm attack        against the local dev server
//   pnpm attack:prod   against the deployed site (read-only cases only)
//
// `pnpm api` proves a legitimate request works and `pnpm rls` proves the
// database refuses a foreign row. Neither asks what happens when somebody who
// IS signed in sends a request they should not — a waiter naming another
// restaurant's table, a kitchen login collecting cash, the same collection
// twice, a tip with six noughts on it.
//
// Every case is judged on EFFECT, never on the absence of an error. A write
// that RLS filters to zero rows returns no error at all, and reading that as
// "allowed" once reported four tables as wide open that were all fine. So the
// ledger is counted before and after, with the secret key, and the question is
// always: did a peso move that should not have?
//
// Nothing it creates is left behind.
// ============================================================================
import { createClient } from "@supabase/supabase-js";

const prod = process.argv.includes("--prod");
process.loadEnvFile(prod ? ".env.production.local" : ".env.development.local");

// The same host every other prod-facing check uses, so this one cannot end up
// quietly pointed somewhere else.
const base = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
);

let failed = 0;
const ok = m => console.log(`    ok       ${m}`);
const bad = m => { failed++; console.log(`    BAD      ${m}`); };

/** A signed-in browser's cookie, the way the app's own harness makes one. */
async function cookieFor(email) {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const { data, error } = await c.auth.signInWithPassword({ email, password: "demo123" });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  const session = Buffer.from(JSON.stringify(data.session)).toString("base64");
  return `sb-${ref}-auth-token=base64-${session}`;
}

async function get(path, cookie) {
  const res = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function patch(path, body, cookie) {
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function post(path, body, cookie) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Every peso recorded against a restaurant, however it was recorded. */
async function takings(restaurantId) {
  const { data } = await admin
    .from("payments").select("amount, tip").eq("restaurant_id", restaurantId);
  return (data ?? []).reduce(
    (sum, p) => ({
      amount: sum.amount + Number(p.amount),
      tip: sum.tip + Number(p.tip ?? 0),
      rows: sum.rows + 1,
    }),
    { amount: 0, tip: 0, rows: 0 },
  );
}

console.log(`\nAttacking the money routes — ${prod ? "production" : "development"}\n`);

if (prod) {
  console.log("    –        production: nothing here may plant an order, so this is not run");
  console.log("\nSkipped.\n");
  process.exit(0);
}

const { data: restaurants } = await admin.from("restaurants").select("id, name");
const home = restaurants.find(r => r.name === "Demo Bistro") ?? restaurants[0];
const neighbour = restaurants.find(r => r.id !== home.id);
if (!neighbour) {
  console.log("    BAD      only one restaurant exists — cross-tenant cases cannot run\n");
  process.exit(1);
}

const who = {
  waiter: await cookieFor("demo-waiter@tabletap.dev"),
  kitchen: await cookieFor("demo-kitchen@tabletap.dev"),
};

// A table of our own, made for this and nothing else. Borrowing a real one
// would have meant borrowing its sitting — a table may only have one open at a
// time — and an attack that alters a table the floor is using is an attack on
// the restaurant rather than on the routes.
const MARK = "attack-money";
const { data: table } = await admin
  .from("restaurant_tables").insert({ restaurant_id: home.id, label: MARK })
  .select("id, label").maybeSingle();
if (!table) {
  console.log("    BAD      could not create a table to attack\n");
  process.exit(1);
}
const { data: sitting } = await admin
  .from("table_sessions").insert({ restaurant_id: home.id, table_id: table.id })
  .select("id").maybeSingle();
const { data: order } = await admin.from("orders").insert({
  restaurant_id: home.id, table_id: table.id, table_label: table.label,
  session_id: sitting?.id ?? null, status: "received", paid: false,
  subtotal: 100, service_fee: 0, tip: 0, tax_pct: 0, total: 100, currency: "MXN",
  note: MARK,
  items: [{ itemId: "x", name: "attack fixture", emoji: "x", price: 100, qty: 1, mods: {} }],
}).select("id").maybeSingle();

const { data: theirTable } = await admin
  .from("restaurant_tables").select("id").eq("restaurant_id", neighbour.id)
  .limit(1).maybeSingle();

// A live ticket of the neighbour's, planted rather than borrowed: what they
// happen to have on their board is not something a check may depend on, and
// the ones that fail for having nothing to attack are the ones that pass
// without asking anything.
const { data: theirTicket } = await admin.from("orders").insert({
  restaurant_id: neighbour.id, status: "received", paid: true, subtotal: 11.5,
  service_fee: 0, tip: 0, tax_pct: 0, total: 11.5, currency: "MXN", note: MARK,
  items: [{ itemId: "x", name: "attack fixture", emoji: "x", price: 11.5, qty: 1, mods: {} }],
}).select("id, status").maybeSingle();

try {
  // ── Somebody else's table ───────────────────────────────────────────────
  if (theirTable) {
    const before = await takings(neighbour.id);
    const res = await post(
      "/api/table-payment/part",
      { tableId: theirTable.id, amount: 50, tip: 5, method: "cash", ref: `attack-${Date.now()}` },
      who.waiter,
    );
    const after = await takings(neighbour.id);
    after.rows === before.rows && after.amount === before.amount
      ? ok(`a waiter cannot collect against another restaurant's table (${res.status})`)
      : bad(`a waiter moved ${(after.amount - before.amount).toFixed(2)} into another restaurant`);
  } else {
    bad("the neighbour has no table — the cross-tenant case did not run");
  }

  // ── Somebody else's bill, read rather than collected ────────────────────
  if (theirTable) {
    const res = await get(`/api/table-bill?tableId=${theirTable.id}`, who.waiter);
    const empty = (res.body.orders ?? []).length === 0 && (res.body.outstanding?.owed ?? 0) === 0;
    empty
      ? ok("a waiter cannot read what another restaurant's table owes")
      : bad(`a waiter read ${res.body.orders?.length} order(s) and ${res.body.outstanding?.owed} owed elsewhere`);
  }

  // ── Somebody else's ticket, moved off the pass ──────────────────────────
  {
    const theirs = theirTicket;
    if (theirs) {
      await patch("/api/orders", { id: theirs.id, status: "completed" }, who.waiter);
      const { data: now } = await admin
        .from("orders").select("status").eq("id", theirs.id).maybeSingle();
      now?.status === theirs.status
        ? ok("a waiter cannot move another restaurant's ticket")
        : bad(`a waiter moved another restaurant's ticket to ${now?.status}`);
    } else {
      bad("could not plant the neighbour a ticket — the cross-tenant move did not run");
    }
  }

  // ── The kitchen, which never handles money ──────────────────────────────
  {
    const before = await takings(home.id);
    const res = await post(
      "/api/table-payment/part",
      { tableId: table.id, amount: 10, method: "cash", ref: `attack-k-${Date.now()}` },
      who.kitchen,
    );
    const after = await takings(home.id);
    res.status === 403 && after.rows === before.rows
      ? ok("a kitchen login cannot collect a bill")
      : bad(`a kitchen login collected: ${res.status}, ${after.rows - before.rows} row(s)`);
  }

  // ── Nobody at all ───────────────────────────────────────────────────────
  {
    const before = await takings(home.id);
    const res = await post(
      "/api/table-payment/part",
      { tableId: table.id, amount: 10, method: "cash", ref: `attack-a-${Date.now()}` },
      null,
    );
    const after = await takings(home.id);
    res.status === 403 && after.rows === before.rows
      ? ok("a request with no login cannot collect a bill")
      : bad(`an anonymous request collected: ${res.status}`);
  }

  // ── More than the table owes ────────────────────────────────────────────
  {
    const res = await post(
      "/api/table-payment/part",
      { tableId: table.id, amount: 1_000_000, tip: 999_999, method: "cash",
        ref: `attack-big-${Date.now()}` },
      who.waiter,
    );
    const { data: row } = await admin
      .from("payments").select("amount, tip").eq("session_id", sitting.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: after } = await admin
      .from("orders").select("total, tip, paid").eq("id", order.id).maybeSingle();
    // 100 of food is all there was; the tip is capped at the food it thanks
    // somebody for, exactly as every other tip in the app is.
    Number(row?.amount) === 200 && Number(row?.tip) === 100 && res.body.settled === true
      ? ok("a mistyped million collects the bill and no more")
      : bad(`a mistyped million recorded ${row?.amount} with ${row?.tip} of tip`);
    Number(after?.total) === 200 && after?.paid === true
      ? ok("and the order carries exactly the gratuity that was taken")
      : bad(`the order reads ${after?.total} with ${after?.tip} of tip, paid=${after?.paid}`);
  }

  // ── The same tap twice ──────────────────────────────────────────────────
  {
    const { data: second } = await admin.from("orders").insert({
      restaurant_id: home.id, table_id: table.id, table_label: table.label,
      session_id: sitting.id, status: "received", paid: false,
      subtotal: 60, service_fee: 0, tip: 0, tax_pct: 0, total: 60, currency: "MXN",
      note: MARK,
      items: [{ itemId: "x", name: "attack fixture", emoji: "x", price: 60, qty: 1, mods: {} }],
    }).select("id").maybeSingle();

    const ref = `attack-dup-${Date.now()}`;
    const before = await takings(home.id);
    const one = await post("/api/table-payment/part",
      { tableId: table.id, amount: 20, method: "cash", ref }, who.waiter);
    const two = await post("/api/table-payment/part",
      { tableId: table.id, amount: 20, method: "cash", ref }, who.waiter);
    if (one.status !== 200) bad(`the first of the two was refused: ${one.status} ${one.body.error ?? ""}`);
    const after = await takings(home.id);
    after.rows - before.rows === 1 && Math.abs(after.amount - before.amount - 20) < 0.005
      ? ok("the same collection sent twice lands in the ledger once")
      : bad(`sending it twice added ${after.rows - before.rows} row(s), ${(after.amount - before.amount).toFixed(2)}`);

    const { data: still } = await admin
      .from("orders").select("paid").eq("id", second?.id ?? "").maybeSingle();
    still?.paid === false
      ? ok("and the bill it did not cover stays open")
      : bad("a bill closed on a collection that covered part of it");
  }

  // ── A table owing on two sittings ───────────────────────────────────────
  //
  // An old sitting expires with something still on it and the next party opens
  // another. The waiter settles the table, which is both. Found on a live
  // table: all of it was recorded against one sitting, leaving that one
  // holding money it did not owe and the other marked paid with nothing
  // behind it.
  {
    // Its own table. The cases above leave this one part-collected, and a
    // third sitting in the mix measures something other than what is being
    // asked here.
    const { data: two } = await admin
      .from("restaurant_tables").insert({ restaurant_id: home.id, label: `${MARK}-2` })
      .select("id, label").maybeSingle();
    const { data: stale } = await admin.from("table_sessions").insert({
      restaurant_id: home.id, table_id: two.id,
      closed_at: new Date().toISOString(), close_reason: "expired",
    }).select("id").maybeSingle();
    const { data: old } = await admin.from("orders").insert({
      restaurant_id: home.id, table_id: two.id, table_label: two.label,
      session_id: stale?.id ?? null, status: "received", paid: false,
      subtotal: 40, service_fee: 0, tip: 0, tax_pct: 0, total: 40, currency: "MXN",
      note: MARK,
      items: [{ itemId: "x", name: "attack fixture", emoji: "x", price: 40, qty: 1, mods: {} }],
    }).select("id").maybeSingle();
    const { data: fresh } = await admin.from("table_sessions").insert({
      restaurant_id: home.id, table_id: two.id,
    }).select("id").maybeSingle();
    const { data: recent } = await admin.from("orders").insert({
      restaurant_id: home.id, table_id: two.id, table_label: two.label,
      session_id: fresh?.id ?? null, status: "received", paid: false,
      subtotal: 10, service_fee: 0, tip: 0, tax_pct: 0, total: 10, currency: "MXN",
      note: MARK,
      items: [{ itemId: "x", name: "attack fixture", emoji: "x", price: 10, qty: 1, mods: {} }],
    }).select("id").maybeSingle();

    // 50 of food across two sittings, and 5 of gratuity on top.
    const res = await post("/api/table-payment/part",
      { tableId: two.id, amount: 50, tip: 5, method: "cash", ref: `attack-two-${Date.now()}` },
      who.waiter);

    const money = async id => {
      const { data } = await admin.from("payments").select("amount").eq("session_id", id);
      return Number((data ?? []).reduce((s, p) => s + Number(p.amount), 0).toFixed(2));
    };
    const owed = async id => {
      const { data } = await admin.from("orders").select("total").eq("session_id", id);
      return Number((data ?? []).reduce((s, o) => s + Number(o.total), 0).toFixed(2));
    };
    const [oldGot, oldOwed, newGot, newOwed] = await Promise.all([
      money(stale.id), owed(stale.id), money(fresh.id), owed(fresh.id),
    ]);
    // 40 of food plus the whole 5 of gratuity, which lands on the oldest order.
    oldGot === oldOwed && newGot === newOwed && res.body.settled === true
      ? ok("a collection is shared across the sittings it pays for")
      : bad(`old owed ${oldOwed} got ${oldGot}, new owed ${newOwed} got ${newGot}`);

    // Tidy: the money, then the orders, then the sittings and the table.
    await admin.from("payments").delete().in("session_id", [stale.id, fresh.id]);
    await admin.from("orders").delete().in("id", [old?.id, recent?.id].filter(Boolean));
    await admin.from("table_sessions").delete().in("id", [stale.id, fresh.id]);
    await admin.from("restaurant_tables").delete().eq("id", two.id);
  }

  // ── A table dividing its bill is not payable whole ──────────────────────
  //
  // Three phones ordered; two of them agreed to halve it and the split froze.
  // The third never joined, so its screen never hid the whole-bill button —
  // and nothing on the server refused it. Both halves get paid AND the whole
  // bill gets paid: the table is charged twice for one dinner.
  {
    await admin.from("table_sessions").update({ opened_by: null }).eq("id", sitting.id);
    const { data: owed } = await admin
      .from("orders").select("id, total").eq("session_id", sitting.id).eq("paid", false);
    const whole = Number((owed ?? []).reduce((s, o) => s + Number(o.total), 0).toFixed(2));

    const { data: made } = await admin.from("bill_splits").insert({
      restaurant_id: home.id, session_id: sitting.id, shares: 2,
      status: "locked", amount: whole, proposed_by: "attack-a",
      locked_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    await admin.from("bill_split_claims").insert([
      { split_id: made.id, share_no: 0, diner: "attack-a", amount: whole / 2 },
      { split_id: made.id, share_no: 1, diner: "attack-b", amount: whole / 2 },
    ]);

    // Cards ON for this one. With no Stripe account the route refuses every
    // caller at the door, and this case would have passed without ever
    // reaching the question it exists to ask.
    const { data: was } = await admin.from("restaurants")
      .select("stripe_account_id, stripe_charges_enabled").eq("id", home.id).single();
    await admin.from("restaurants")
      .update({ stripe_account_id: "acct_attack", stripe_charges_enabled: true })
      .eq("id", home.id);

    const before = await takings(home.id);
    const res = await post("/api/bill/pay", {
      restaurantId: home.id, tableId: table.id, orderIds: (owed ?? []).map(o => o.id),
    }, null);
    const after = await takings(home.id);
    // 409 and no url. Without the guard it gets past this point and asks
    // Stripe, which refuses the made-up account with a 502 — so the two
    // answers tell the check apart from the bug it is looking for.
    res.status === 409 && !res.body.url && after.rows === before.rows
      ? ok("a diner cannot pay the whole bill while the table is dividing it")
      : bad(`the online bill route answered ${res.status}${res.body.url ? " with a checkout url" : ""} on a locked split`);

    await admin.from("restaurants").update({
      stripe_account_id: was.stripe_account_id,
      stripe_charges_enabled: was.stripe_charges_enabled,
    }).eq("id", home.id);
    await admin.from("bill_split_claims").delete().eq("split_id", made.id);
    await admin.from("bill_splits").delete().eq("id", made.id);
  }

  // ── A share cannot be paid into a bill that has already been settled ────
  //
  // The share is the amount frozen when the table agreed, and nothing about it
  // knows what has happened since. A waiter takes the cash, the sitting closes
  // — and a diner who had not got round to their share could still be charged
  // for it. Their money, for food nobody owes for any more.
  {
    const { data: spare } = await admin.from("restaurant_tables")
      .insert({ restaurant_id: home.id, label: `${MARK}-settled` }).select("id").maybeSingle();
    const { data: sat } = await admin.from("table_sessions")
      .insert({ restaurant_id: home.id, table_id: spare.id }).select("id").maybeSingle();
    // Already paid for: the bill is gone, the sitting is closed.
    await admin.from("orders").insert({
      restaurant_id: home.id, table_id: spare.id, table_label: `${MARK}-settled`,
      session_id: sat.id, items: [], subtotal: 80, total: 80, currency: "MXN",
      status: "completed", paid: true, note: MARK,
    });
    await admin.from("table_sessions")
      .update({ closed_at: new Date().toISOString(), close_reason: "settled" }).eq("id", sat.id);

    const { data: stale } = await admin.from("bill_splits").insert({
      restaurant_id: home.id, session_id: sat.id, shares: 2, status: "locked",
      amount: 80, proposed_by: "attack-a", locked_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    await admin.from("bill_split_claims").insert([
      { split_id: stale.id, share_no: 0, diner: "attack-a", amount: 40, paid_at: new Date().toISOString() },
      { split_id: stale.id, share_no: 1, diner: "attack-b", amount: 40 },
    ]);

    // Cards ON, for the same reason as the case above: with no Stripe account
    // the route refuses everyone at the door and this would pass without ever
    // asking its question.
    const { data: was } = await admin.from("restaurants")
      .select("stripe_account_id, stripe_charges_enabled").eq("id", home.id).single();
    await admin.from("restaurants")
      .update({ stripe_account_id: "acct_attack", stripe_charges_enabled: true })
      .eq("id", home.id);

    const before = await takings(home.id);
    const res = await post("/api/split/pay", {
      splitId: stale.id, sessionId: sat.id, diner: "attack-b",
      restaurantId: home.id, tableId: spare.id, ownOrderIds: [],
    }, null);
    const after = await takings(home.id);
    await admin.from("restaurants").update({
      stripe_account_id: was.stripe_account_id,
      stripe_charges_enabled: was.stripe_charges_enabled,
    }).eq("id", home.id);
    res.status === 409 && !res.body.url && after.rows === before.rows
      ? ok("a share cannot be charged for a bill that is already settled")
      : bad(`the share route answered ${res.status}${res.body.url ? " with a checkout url" : ""} on a settled bill`);

    await admin.from("bill_split_claims").delete().eq("split_id", stale.id);
    await admin.from("bill_splits").delete().eq("id", stale.id);
    await admin.from("orders").delete().eq("session_id", sat.id);
    await admin.from("table_sessions").delete().eq("id", sat.id);
    await admin.from("restaurant_tables").delete().eq("id", spare.id);
  }

  // ── Cash at the table ends the division of that bill ────────────────────
  //
  // A share is frozen when the table agrees and nothing about it moves again.
  // A waiter then takes part of the bill in cash: the sitting stays open —
  // `close_session_if_clear` only closes when the whole thing is covered — so
  // the split stays locked and every share is still the figure it was. MX$200
  // divided two ways, MX$120 taken at the table, both halves still chargeable:
  // MX$320 collected for a MX$200 dinner.
  {
    const { data: spare } = await admin.from("restaurant_tables")
      .insert({ restaurant_id: home.id, label: `${MARK}-part` }).select("id").maybeSingle();
    const { data: sat } = await admin.from("table_sessions")
      .insert({ restaurant_id: home.id, table_id: spare.id }).select("id").maybeSingle();
    await admin.from("orders").insert({
      restaurant_id: home.id, table_id: spare.id, table_label: `${MARK}-part`,
      session_id: sat.id, items: [], subtotal: 200, total: 200, currency: "MXN",
      status: "ready", paid: false, note: MARK,
    });
    const { data: frozen } = await admin.from("bill_splits").insert({
      restaurant_id: home.id, session_id: sat.id, shares: 2, status: "locked",
      amount: 200, proposed_by: "attack-a", locked_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    await admin.from("bill_split_claims").insert([
      { split_id: frozen.id, share_no: 0, diner: "attack-a", amount: 100 },
      { split_id: frozen.id, share_no: 1, diner: "attack-b", amount: 100 },
    ]);

    // The waiter takes MX$120 of it at the table, through the calculator.
    const took = await post("/api/table-payment/part",
      { tableId: spare.id, amount: 120, method: "cash", ref: `${MARK}-part-${Date.now()}` },
      who.waiter);

    const { data: now } = await admin.from("bill_splits")
      .select("status").eq("id", frozen.id).single();
    took.status === 200 && now.status !== "locked"
      ? ok("cash at the table ends the division of that bill")
      : bad(`the waiter collected (${took.status}) and the split is still "${now.status}"`);

    // And the share that outlived it cannot be charged. Cards on, or the route
    // refuses at the door and this proves nothing.
    const { data: was } = await admin.from("restaurants")
      .select("stripe_account_id, stripe_charges_enabled").eq("id", home.id).single();
    await admin.from("restaurants")
      .update({ stripe_account_id: "acct_attack", stripe_charges_enabled: true })
      .eq("id", home.id);
    const before = await takings(home.id);
    const res = await post("/api/split/pay", {
      splitId: frozen.id, sessionId: sat.id, diner: "attack-b",
      restaurantId: home.id, tableId: spare.id, ownOrderIds: [],
    }, null);
    const after = await takings(home.id);
    await admin.from("restaurants").update({
      stripe_account_id: was.stripe_account_id,
      stripe_charges_enabled: was.stripe_charges_enabled,
    }).eq("id", home.id);
    // 409 is the refusal. Without it the route gets all the way to Stripe,
    // which turns the made-up account down with a 502 — so the two answers
    // tell the guard apart from the bug it is looking for.
    res.status === 409 && !res.body.url && after.rows === before.rows
      ? ok("and the share frozen before it cannot be charged")
      : bad(`the share route answered ${res.status}${res.body.url ? " with a checkout url" : ""} after the waiter took the cash`);

    await admin.from("payments").delete().eq("session_id", sat.id);
    await admin.from("bill_split_claims").delete().eq("split_id", frozen.id);
    await admin.from("bill_splits").delete().eq("id", frozen.id);
    await admin.from("orders").delete().eq("session_id", sat.id);
    await admin.from("table_sessions").delete().eq("id", sat.id);
    await admin.from("restaurant_tables").delete().eq("id", spare.id);
    await admin.from("user_logs").delete()
      .eq("restaurant_id", home.id).eq("entity", "bill").eq("action", "collected")
      .like("detail", `table=${MARK}-part%`);
  }

  // ── Six people going for the last portion at once ───────────────────────
  //
  // `reserve_stock` takes `for update` on the rows it is about to spend, which
  // is the right shape — but "the right shape" is what the collection path
  // looked like too, and that one sold MX$400 of a MX$200 bill. Overselling
  // food is the same failure wearing a different hat: somebody is promised a
  // dish the kitchen cannot make, and the floor finds out in front of them.
  //
  // This one passed the day it was written, which is worth saying plainly: it
  // is here to keep an answer that is already right.
  {
    const { data: liveMenu } = await admin.from("menus").select("id")
      .eq("restaurant_id", home.id).eq("active", true).is("schedule", null)
      .order("sort_order").limit(1).maybeSingle();
    const { data: dish } = liveMenu
      ? await admin.from("menu_items")
          .select("id, name, price, emoji, stock, available")
          .eq("restaurant_id", home.id).eq("menu_id", liveMenu.id)
          .eq("is_addon", false).eq("available", true).order("name").limit(1).maybeSingle()
      : { data: null };

    if (!dish) {
      bad("no dish on a serving menu — the last-portion race went unchecked");
    } else {
      const { data: spare } = await admin.from("restaurant_tables")
        .insert({ restaurant_id: home.id, label: `${MARK}-stock` }).select("id").maybeSingle();
      await admin.from("menu_items")
        .update({ stock: 1, available: true, stock_auto_off: false }).eq("id", dish.id);

      const line = {
        itemId: dish.id, name: dish.name, emoji: dish.emoji ?? "\u{1F37D}",
        price: Number(dish.price), qty: 1, mods: {},
      };
      const shots = await Promise.all([...Array(6)].map(() =>
        post("/api/table-order", { tableId: spare.id, items: [line] }, who.waiter)));

      const { data: after } = await admin.from("menu_items")
        .select("stock, available").eq("id", dish.id).single();
      const sold = shots.filter(s => s.status === 200).length;

      sold <= 1 && Number(after.stock) >= 0
        ? ok("six at once for the last portion sell it once")
        : bad(`${sold} sales of one portion, stock left at ${after.stock}`);

      // And the dish takes itself off the menu rather than sitting there at zero.
      Number(after.stock) === 0 && after.available === false
        ? ok("and the dish comes off the menu when it runs out")
        : bad(`stock ${after.stock} but available=${after.available}`);

      await admin.from("orders").delete().eq("table_id", spare.id);
      await admin.from("table_sessions").delete().eq("table_id", spare.id);
      await admin.from("restaurant_tables").delete().eq("id", spare.id);
      await admin.from("menu_items").update({
        stock: dish.stock, available: dish.available, stock_auto_off: false,
      }).eq("id", dish.id);
      await admin.from("notifications")
        .delete().eq("restaurant_id", home.id).eq("kind", "out_of_stock");
    }
  }

  // ── Two waiters, one table, the same instant ────────────────────────────
  //
  // The calculator read what was owed, capped the amount against that, and
  // inserted — three steps with nothing holding the table still between the
  // first and the last. Two requests both read MX$200 owing and both recorded
  // it: MX$400 taken for a MX$200 dinner. Five at once took MX$800.
  //
  // `client_ref` never caught it and was never going to: that guards ONE
  // collection retried, and these are collections that genuinely differ.
  {
    const { data: spare } = await admin.from("restaurant_tables")
      .insert({ restaurant_id: home.id, label: `${MARK}-race` }).select("id, label").maybeSingle();
    const { data: sat } = await admin.from("table_sessions")
      .insert({ restaurant_id: home.id, table_id: spare.id }).select("id").maybeSingle();
    await admin.from("orders").insert({
      restaurant_id: home.id, table_id: spare.id, table_label: spare.label,
      session_id: sat.id, items: [], subtotal: 200, total: 200, currency: "MXN",
      status: "ready", paid: false, note: MARK,
    });

    // Five at once, each asking for the whole bill, each with its own
    // reference so the duplicate guard cannot be what saves us.
    const shots = await Promise.all([...Array(5)].map((_, i) =>
      post("/api/table-payment/part",
        { tableId: spare.id, amount: 200, method: "cash", ref: `${MARK}-race-${i}` },
        who.waiter)));

    const { data: rows } = await admin.from("payments").select("amount").eq("session_id", sat.id);
    const got = Number((rows ?? []).reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2));
    const ok200 = shots.filter(s => s.status === 200).length;

    got <= 200
      ? ok(`five collections at once take no more than the bill (MX$${got} of MX$200)`)
      : bad(`MX$${got} collected on a MX$200 bill by ${ok200} simultaneous requests`);

    // And the losers are told they lost, rather than handed a server error.
    shots.every(s => [200, 409].includes(s.status))
      ? ok("and the ones that lost the race are told the bill is covered")
      : bad(`a lost race answered ${shots.map(s => s.status).join("/")} — 500 is not an answer`);

    await admin.from("payments").delete().eq("session_id", sat.id);
    await admin.from("orders").delete().eq("session_id", sat.id);
    await admin.from("table_sessions").delete().eq("id", sat.id);
    await admin.from("restaurant_tables").delete().eq("id", spare.id);
    await admin.from("user_logs").delete()
      .eq("restaurant_id", home.id).eq("entity", "bill")
      .like("detail", `table=${MARK}-race%`);
  }

  // ── A bill the waiter opened is not payable online ──────────────────────
  {
    await admin.from("table_sessions")
      .update({ opened_by: "demo-waiter@tabletap.dev" }).eq("id", sitting.id);
    const { data: owed } = await admin
      .from("orders").select("id").eq("session_id", sitting.id).eq("paid", false);
    const before = await takings(home.id);
    const res = await post("/api/bill/pay", {
      restaurantId: home.id, tableId: table.id, orderIds: (owed ?? []).map(o => o.id),
    }, null);
    const after = await takings(home.id);
    res.status === 409 && !res.body.url && after.rows === before.rows
      ? ok("a diner cannot pay online for a bill the waiter opened")
      : bad(`the online bill route answered ${res.status}${res.body.url ? " with a checkout url" : ""}`);

    const split = await post("/api/split", {
      sessionId: sitting.id, diner: "attack", restaurantId: home.id,
      tableId: table.id, shares: 2,
    }, null);
    const { count } = await admin
      .from("bill_splits").select("id", { count: "exact", head: true })
      .eq("session_id", sitting.id);
    split.status === 409 && (count ?? 0) === 0
      ? ok("and nobody can divide it on their phone either")
      : bad(`the split route answered ${split.status} and left ${count} split(s)`);
  }
} finally {
  // Everything, in the order that leaves nothing holding a reference. The
  // ledger first: `payments.order_id` is `on delete set null`, so removing the
  // orders first would cut these loose rather than remove them.
  const { data: mine } = await admin.from("orders").select("id").eq("note", MARK);
  const ids = (mine ?? []).map(o => o.id);
  if (ids.length) await admin.from("payments").delete().in("order_id", ids);
  if (sitting?.id) {
    await admin.from("payments").delete().eq("session_id", sitting.id);
    await admin.from("bill_splits").delete().eq("session_id", sitting.id);
  }
  await admin.from("orders").delete().eq("note", MARK);
  if (sitting?.id) await admin.from("table_sessions").delete().eq("id", sitting.id);
  await admin.from("restaurant_tables").delete().eq("id", table.id);
  // The lines those collections wrote, so the drawer and the ledger still
  // agree afterwards. Found by the table's name, which nothing else has.
  await admin.from("user_logs").delete()
    .eq("restaurant_id", home.id).eq("entity", "bill")
    .in("action", ["paid", "collected"])
    .like("detail", `table=${MARK}%`);
}

console.log(
  failed === 0
    ? "\nNo peso moved that should not have.\n"
    : `\n${failed} PROBLEM(S) — fix before shipping.\n`,
);
process.exit(failed === 0 ? 0 : 1);
