// Every mutating route, as every identity. Bogus ids throughout, so a guard
// that passes fails on the DATA instead of writing anything.
import { createClient } from "@supabase/supabase-js";
import { join } from "node:path";
process.loadEnvFile(join(process.cwd(), ".env.development.local"));
const BASE = "http://localhost:3000";
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const NIL = "00000000-0000-4000-8000-000000000000";

const who = { anon: "" };
for (const [role, email] of [["owner","demo@tabletap.dev"],["manager","demo-manager@tabletap.dev"],
  ["waiter","demo-waiter@tabletap.dev"],["cashier","demo-cashier@tabletap.dev"],["kitchen","demo-kitchen@tabletap.dev"]]) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const { data } = await c.auth.signInWithPassword({ email, password: "demo123" });
  who[role] = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`;
}

// route, method, body, and who SHOULD get past the guard
const CASES = [
  ["/api/settings",              "POST",  { accepting_orders: true },                 ["owner","manager"]],
  ["/api/staff",                 "POST",  { email: "x@y.dev", role: "waiter" },       ["owner"]],
  ["/api/coupons",               "POST",  { code: "", kind: "percent", value: 1 },    ["owner","manager"]],
  ["/api/promotions",            "POST",  { name: "" },                               ["owner","manager"]],
  ["/api/dietary-tags",          "POST",  { key: "" },                                ["owner","manager"]],
  ["/api/icon-groups",           "POST",  { name: "" },                               ["owner","manager"]],
  ["/api/print/token",           "POST",  {},                                         ["owner","manager"]],
  ["/api/orders/cancel",         "POST",  { id: NIL },                                ["owner","manager"]],
  ["/api/bill/write-off",        "POST",  { orderIds: [NIL], reason: "walkout" },     ["owner","manager","waiter","cashier"]],
  ["/api/bill/write-off/approve","POST",  { id: NIL, approve: false },                ["owner","manager"]],
  ["/api/bill/discount",         "POST",  { tableId: NIL, code: "X" },                ["owner","manager","waiter","cashier"]],
  ["/api/bill/discount/approve", "POST",  { id: NIL, approve: false },                ["owner","manager"]],
  ["/api/table-payment",         "POST",  { orderId: NIL, settlement: "cash" },       ["owner","manager","waiter","cashier"]],
  ["/api/table-payment/part",    "POST",  { tableId: NIL, amount: 1, method: "cash", ref: "m" }, ["owner","manager","waiter","cashier"]],
  ["/api/table-order",           "POST",  { tableId: NIL, items: [] },                ["owner","manager","waiter"]],
  ["/api/pos/order",             "POST",  { posRef: NIL, method: "cash", items: [] }, ["owner","manager","cashier"]],
  ["/api/orders",                "PATCH", { id: NIL, status: "ready" },               ["owner","manager","waiter","kitchen"]],
  ["/api/billing/checkout",      "POST",  { plan: "casa" },                           ["owner"]],
  ["/api/admin/users",           "POST",  { email: "x@y.dev" },                       []],
  ["/api/admin/restaurants",     "DELETE",{ id: NIL },                                []],
];

const roles = ["anon","owner","manager","waiter","cashier","kitchen"];
console.log("route".padEnd(30) + roles.map(r=>r.slice(0,7).padStart(8)).join("") + "   verdict");
let problems = 0;
for (const [path, method, body, allowed] of CASES) {
  const out = [];
  const leaks = [];
  for (const role of roles) {
    const res = await fetch(BASE + path, {
      method, headers: { "content-type": "application/json", ...(who[role] ? { cookie: who[role] } : {}) },
      body: JSON.stringify(body),
    });
    out.push(String(res.status).padStart(8));
    const past = ![401, 403].includes(res.status);
    if (past && !allowed.includes(role)) leaks.push(role);
  }
  if (leaks.length) problems++;
  console.log(path.padEnd(30) + out.join("") + (leaks.length ? `   PAST GUARD: ${leaks.join(",")}` : "   ok"));
}
console.log(problems === 0 ? "\nEvery role stayed inside its boundary.\n" : `\n${problems} route(s) let somebody past.\n`);
