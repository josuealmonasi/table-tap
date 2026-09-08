// ============================================================================
// The ledger and the boolean have to tell the same story.
//
// `orders.paid` says an order is settled; `payments` says money arrived. Two
// records of one fact is the shape of every bug this app has had, so this is
// the thing that notices when they drift — a paid order nobody was charged
// for, a payment for more than the order was worth, or money against an order
// that is not paid.
//
// Reads only. Add `--prod` to ask production the same question.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { join } from "node:path";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const CENT = 0.011; // a cent of slack, for rounding that happened elsewhere

let failed = 0;
const ok = w => console.log(`    ok       ${w}`);
const bad = w => { failed++; console.log(`    BAD      ${w}`); };

console.log(`\nMoney — ${prod ? "production" : "development"}\n`);

const { data: orders, error: oErr } = await db
  .from("orders")
  .select("id, restaurant_id, total, paid, written_off, status");
if (oErr) { console.log(`  cannot read orders: ${oErr.message}`); process.exit(1); }

const { data: payments, error: pErr } = await db
  .from("payments")
  .select("id, order_id, amount");
if (pErr) { console.log(`  cannot read payments: ${pErr.message}`); process.exit(1); }

const paidFor = new Map();
for (const p of payments) {
  if (!p.order_id) continue; // a share of a divided bill belongs to a sitting
  paidFor.set(p.order_id, (paidFor.get(p.order_id) ?? 0) + Number(p.amount));
}

// 1. Every settled order has money behind it.
const settled = orders.filter(o => o.paid && !o.written_off && Number(o.total) > 0);
const unbacked = settled.filter(o => !paidFor.has(o.id));
unbacked.length === 0
  ? ok(`every settled order has a payment (${settled.length} checked)`)
  : bad(`${unbacked.length} settled order(s) with no payment: ${unbacked.slice(0, 3).map(o => o.id.slice(0, 8)).join(", ")}`);

// 2. And the right amount of it.
const wrong = settled.filter(o => paidFor.has(o.id) && Math.abs(paidFor.get(o.id) - Number(o.total)) > CENT);
wrong.length === 0
  ? ok("every settled order is paid for its own total")
  : bad(`${wrong.length} order(s) paid an amount that is not their total: ${wrong.slice(0, 3).map(o => `${o.id.slice(0, 8)} owed ${o.total} got ${paidFor.get(o.id)}`).join("; ")}`);

// 3. Nothing was charged for an order that is not settled.
const byId = new Map(orders.map(o => [o.id, o]));
const ghosts = [...paidFor.keys()].filter(id => {
  const o = byId.get(id);
  return o && !o.paid && o.status !== "cancelled";
});
ghosts.length === 0
  ? ok("no payment against an unsettled order")
  : bad(`${ghosts.length} payment(s) against an order that is not paid: ${ghosts.slice(0, 3).map(i => i.slice(0, 8)).join(", ")}`);

// 4. Nothing negative or free ever got in.
const nonsense = payments.filter(p => !(Number(p.amount) > 0));
nonsense.length === 0
  ? ok("every payment is a real amount")
  : bad(`${nonsense.length} payment(s) of zero or less`);

// ── The drawer ──────────────────────────────────────────────────────────────
//
// The corte a cashier signs is built from `user_logs`; the ledger an owner
// audits is `payments`. One route writes both, in the same request, and until
// now nothing compared them — so the two records of one night's cash could
// drift apart with no one the wiser.
//
// Only from the moment the ledger began naming who took the money. Everything
// before that is the backfill, which was built from `orders` and could not know
// an actor; that history is not recoverable and is not this check's business.
const { data: staffPaid, error: sErr } = await db
  .from("payments")
  .select("actor_email, method, amount, created_at")
  .not("actor_email", "is", null)
  .order("created_at");
if (sErr) { console.log(`  cannot read payments: ${sErr.message}`); process.exit(1); }

const era = staffPaid[0]?.created_at;

if (!era) {
  console.log("    –        no staff-taken payment yet — nothing to reconcile");
} else {
  const { data: logs, error: lErr } = await db
    .from("user_logs")
    .select("actor_email, detail, created_at")
    .eq("entity", "bill")
    .eq("action", "paid")
    .gte("created_at", era);
  if (lErr) { console.log(`  cannot read user_logs: ${lErr.message}`); process.exit(1); }

  // 5. Cash is handed to a person, so the ledger must name them.
  const anonCash = staffPaid.filter(p => p.method === "cash" && !p.actor_email);
  const { data: allSince } = await db
    .from("payments")
    .select("method, actor_email")
    .eq("method", "cash")
    .gte("created_at", era);
  const nameless = (allSince ?? []).filter(p => !p.actor_email);
  nameless.length === 0 && anonCash.length === 0
    ? ok("every cash payment says who took it")
    : bad(`${nameless.length} cash payment(s) since the ledger began with nobody named`);

  // 6. Per person and method, the drawer and the ledger say the same number.
  const key = (actor, method) => `${actor} · ${method}`;
  const ledger = new Map();
  for (const p of staffPaid) {
    const k = key(p.actor_email, p.method);
    ledger.set(k, (ledger.get(k) ?? 0) + Number(p.amount));
  }

  const drawer = new Map();
  for (const row of logs ?? []) {
    const fields = {};
    for (const part of (row.detail ?? "").split(" ")) {
      const at = part.indexOf("=");
      if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
    }
    const amount = Number(fields.amount);
    if (!Number.isFinite(amount) || !fields.method) continue;
    const k = key(row.actor_email, fields.method);
    drawer.set(k, (drawer.get(k) ?? 0) + amount);
  }

  const drifted = [...new Set([...ledger.keys(), ...drawer.keys()])]
    .map(k => ({ k, l: ledger.get(k) ?? 0, d: drawer.get(k) ?? 0 }))
    .filter(({ l, d }) => Math.abs(l - d) > CENT);

  drifted.length === 0
    ? ok(`the drawer and the ledger agree (${ledger.size} person/method total(s))`)
    : bad(
        `${drifted.length} disagree between the corte and the ledger: ` +
          drifted.slice(0, 3).map(({ k, l, d }) => `${k} — ledger ${l.toFixed(2)}, log ${d.toFixed(2)}`).join("; "),
      );
}

console.log(
  failed === 0
    ? `\nThe ledger, the orders and the drawer agree. ${payments.length} payment(s).\n`
    : `\n${failed} PROBLEM(S).\n`,
);
process.exit(failed === 0 ? 0 : 1);
