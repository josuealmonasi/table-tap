// ============================================================================
// TableTap — what each role can reach
//
// Modules move between screens and who reaches them moves with them. This
// signs in as every real role — owner, manager, waiter, kitchen — and checks
// page by page and route by route that each sees and handles their own, no more.
//
//   pnpm roles          (dev)
//   pnpm roles --prod
// ============================================================================
import { join } from "node:path";
import { requireServer, retryFetch } from "./preflight.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

await requireServer(BASE, prod);

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

const ROLES = [
  { email: "demo@tabletap.dev", password: "demo123", role: "owner" },
  { email: "demo-manager@tabletap.dev", password: "demo123", role: "manager" },
  { email: "demo-waiter@tabletap.dev", password: "demo123", role: "waiter" },
  { email: "demo-cashier@tabletap.dev", password: "demo123", role: "cashier" },
  { email: "demo-kitchen@tabletap.dev", password: "demo123", role: "kitchen" },
];

// Page → who should be able to open it, and text ONLY that page prints.
//
// The HTTP status is no use here: Next's redirect() returns 200 with the
// target's HTML and no Location header, so a forbidden page answers 200 with
// somebody else's content. What tells them apart is what is inside — and the
// marker cannot be a label from the nav bar, which appears on all of them.
// which appears on all of them.
const OWNER = ["owner"];
const MANAGES = ["owner", "manager"];
const OWNER_ONLY = ["owner"];
const SERVES = ["owner", "manager", "waiter", "cashier"];
const ALL = ["owner", "manager", "waiter", "cashier", "kitchen"];

const PAGES = {
  "/dashboard": { allow: MANAGES, marker: "Pedidos entrantes en vivo" },
  // "Activos" rather than a column heading: the board only renders "En
  // preparación" when something is in that column, so the check failed against
  // production for every role purely because the demo there has no live orders.
  // A marker that needs data is a marker that goes red on its own, and a false
  // red teaches people to ignore the real ones.
  "/dashboard/orders": { allow: ALL, marker: "Activos" },
  "/dashboard/bills": {
    allow: SERVES,
    marker: "Busca por mesa o código de pedido",
    // The activity log moved here from Staff. Owner only: the policy on
    // `user_logs` is `owns_restaurant`, so the manager was being shown the whole
    // module with zero rows. This list said MANAGES and passed, because it
    // checked the heading existed and not that the log had anything in it —
    // which is a different thing.
    sections: { "Actividad reciente": OWNER_ONLY },
  },
  "/dashboard/tables": { allow: MANAGES, marker: "Agregar mesa" },
  "/dashboard/analytics": {
    allow: MANAGES,
    marker: "Pedidos por hora del día",
    // History and ratings moved here from the orders board.
    sections: { "Busca por código": MANAGES, "Lo mejor calificado": MANAGES },
  },
  "/dashboard/promotions": { allow: MANAGES, marker: "Nuevo combo" },
  "/dashboard/settings": {
    allow: MANAGES,
    marker: "Guardar ajustes de impuesto",
    // Opening Settings is not permission to touch it all: identity and billing are the owner's.
    sections: { "Zona horaria": OWNER, "Pagos": OWNER },
  },
  "/dashboard/staff": { allow: OWNER, marker: "Accesos del equipo" },
  "/dashboard/plan": { allow: OWNER, marker: "Tu plan" },
};

// Route → roles that should be able to use it.
const ROUTES = [
  { m: "GET", p: "/api/badges", allow: ALL },
  // The bell. Only the people who can order more stock are told a dish is
  // running out — the same line the table's RLS policy draws.
  { m: "GET", p: "/api/notifications", allow: MANAGES },
  { m: "POST", p: "/api/notifications", body: { all: true }, allow: MANAGES },
  { m: "GET", p: "/api/table-bill?tableId=", allow: SERVES, needsTable: true },
  { m: "POST", p: "/api/settings", body: { accepting_orders: true }, allow: MANAGES },
  { m: "POST", p: "/api/coupons", body: { code: "ZZZ-999", kind: "percent", value: 5 }, allow: MANAGES },
  { m: "POST", p: "/api/staff", body: { email: "nope@x.dev", role: "waiter" }, allow: OWNER },
];

let failed = 0;
const ok = m => console.log(`    ok       ${m}`);
const bad = m => { failed++; console.log(`    WRONG    ${m}`); };

const { data: restaurant } = await admin
  .from("restaurants").select("id").eq("name", "Demo Bistro").maybeSingle();
const { data: table } = await admin
  .from("restaurant_tables").select("id").eq("restaurant_id", restaurant.id).limit(1).maybeSingle();

console.log(`\nRoles — ${prod ? "production" : "development"}\n`);

for (const who of ROLES) {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const { data, error } = await auth.auth.signInWithPassword({ email: who.email, password: who.password });
  if (error) { console.log(`  ${who.role}: could not sign in (${error.message})`); failed++; continue; }
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`;
  console.log(`  ${who.role} (${who.email})`);

  for (const [path, { allow, marker }] of Object.entries(PAGES)) {
    const res = await retryFetch(
      BASE + path,
      { headers: { cookie, "accept-language": "es-MX" } },
      BASE,
    );
    const html = res.status === 200 ? await res.text() : "";
    const reached = html.includes(marker);
    const may = allow.includes(who.role);
    if (reached === may) ok(`${may ? "abre" : "rebota de"} ${path}`);
    else bad(`${path}: ${reached ? "opened it" : "did not open it"} and ${may ? "should have" : "should not have"}`);

    // Reaching the page says nothing about what is inside it. Every module that
    // moved screens is checked here, as the role that opened it.
    for (const [text, roles] of Object.entries(reached && may ? (PAGES[path].sections ?? {}) : {})) {
      const sees = html.includes(text);
      const should = roles.includes(who.role);
      if (sees === should) ok(`${sees ? "sees" : "does not see"} «${text}» on ${path}`);
      else bad(`${path}: ${sees ? "sees" : "does not see"} «${text}» and ${should ? "should have" : "should not have"}`);
    }
  }

  for (const r of ROUTES) {
    const path = r.needsTable ? r.p + table.id : r.p;
    const res = await retryFetch(
      BASE + path,
      {
        method: r.m,
        headers: { "Content-Type": "application/json", cookie },
        body: r.body ? JSON.stringify(r.body) : undefined,
      },
      BASE,
    );
    const may = r.allow.includes(who.role);
    const refused = res.status === 401 || res.status === 403;
    if (may && refused) bad(`${r.m} ${r.p.split("?")[0]} refused it (${res.status}) and should have allowed it`);
    else if (!may && !refused) bad(`${r.m} ${r.p.split("?")[0]} let it through (${res.status})`);
    else ok(`${may ? "can" : "cannot"} ${r.m} ${r.p.split("?")[0]}`);
  }
  console.log("");
}

console.log(failed === 0 ? "Each role sees and handles its own.\n" : `${failed} PROBLEM(S).\n`);
process.exit(failed === 0 ? 0 : 1);
