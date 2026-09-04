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
const bad = w => { failed++; console.log(`    MAL      ${w}`); };

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

console.log(
  failed === 0
    ? `\nThe ledger and the orders agree. ${payments.length} payment(s).\n`
    : `\n${failed} PROBLEM(S).\n`,
);
process.exit(failed === 0 ? 0 : 1);
