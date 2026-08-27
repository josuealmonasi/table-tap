// ============================================================================
// TableTap — what each role can reach
//
// Los módulos se mueven de pantalla y con ellos cambia quién los alcanza. Esto
// entra con cada rol de verdad — dueño, gerente, mesero, cocina — y comprueba
// página por página y ruta por ruta que ve y maneja lo que le toca, ni más.
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

// Página → quién debe poder abrirla, y un texto que SÓLO esa página imprime.
//
// El estado HTTP no sirve para esto: redirect() de Next devuelve 200 con el
// HTML del destino y sin cabecera Location, así que una página prohibida
// responde 200 con el contenido de otra. Lo que distingue es lo que trae
// dentro — y el marcador no puede ser un rótulo de la barra de navegación,
// que sale en todas.
const OWNER = ["owner"];
const MANAGES = ["owner", "manager"];
const OWNER_ONLY = ["owner"];
const SERVES = ["owner", "manager", "waiter", "cashier"];
const ALL = ["owner", "manager", "waiter", "cashier", "kitchen"];

const PAGES = {
  "/dashboard": { allow: MANAGES, marker: "Pedidos entrantes en vivo" },
  "/dashboard/orders": { allow: ALL, marker: "En preparación" },
  "/dashboard/bills": {
    allow: SERVES,
    marker: "Busca por mesa o código de pedido",
    // La bitácora se mudó aquí desde Personal. Sólo el dueño: la política de
    // `user_logs` es `owns_restaurant`, así que al gerente se le pintaba el
    // módulo entero con cero renglones. Esta lista decía MANAGES y pasaba,
    // porque comprobaba que el encabezado existiera y no que la bitácora
    // tuviera algo dentro — que es distinto.
    sections: { "Actividad reciente": OWNER_ONLY },
  },
  "/dashboard/tables": { allow: MANAGES, marker: "Agregar mesa" },
  "/dashboard/analytics": {
    allow: MANAGES,
    marker: "Pedidos por hora del día",
    // Historial y calificaciones se mudaron aquí desde el tablero de pedidos.
    sections: { "Busca por código": MANAGES, "Lo mejor calificado": MANAGES },
  },
  "/dashboard/promotions": { allow: MANAGES, marker: "Nuevo combo" },
  "/dashboard/settings": {
    allow: MANAGES,
    marker: "Guardar ajustes de impuesto",
    // Abrir Ajustes no es poder tocarlo todo: identidad y cobros son del dueño.
    sections: { "Zona horaria": OWNER, "Pagos": OWNER },
  },
  "/dashboard/staff": { allow: OWNER, marker: "Accesos del equipo" },
  "/dashboard/plan": { allow: OWNER, marker: "Tu plan" },
};

// Ruta → roles que deben poder usarla.
const ROUTES = [
  { m: "GET", p: "/api/badges", allow: ALL },
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
  if (error) { console.log(`  ${who.role}: no pudo entrar (${error.message})`); failed++; continue; }
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
    else bad(`${path}: ${reached ? "la abrió" : "no la abrió"} y ${may ? "debía" : "no debía"}`);

    // Llegar a la página no dice qué trae dentro. Cada módulo que se mudó de
    // pantalla se comprueba aquí, con el rol que lo abrió.
    for (const [text, roles] of Object.entries(reached && may ? (PAGES[path].sections ?? {}) : {})) {
      const sees = html.includes(text);
      const should = roles.includes(who.role);
      if (sees === should) ok(`${sees ? "ve" : "no ve"} «${text}» en ${path}`);
      else bad(`${path}: ${sees ? "ve" : "no ve"} «${text}» y ${should ? "debía" : "no debía"}`);
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
    if (may && refused) bad(`${r.m} ${r.p.split("?")[0]} lo rechazó (${res.status}) y debía dejarlo`);
    else if (!may && !refused) bad(`${r.m} ${r.p.split("?")[0]} lo dejó pasar (${res.status})`);
    else ok(`${may ? "puede" : "no puede"} ${r.m} ${r.p.split("?")[0]}`);
  }
  console.log("");
}

console.log(failed === 0 ? "Cada rol ve y maneja lo suyo.\n" : `${failed} PROBLEMA(S).\n`);
process.exit(failed === 0 ? 0 : 1);
