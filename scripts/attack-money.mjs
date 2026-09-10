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

const base = prod
  ? (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")
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
