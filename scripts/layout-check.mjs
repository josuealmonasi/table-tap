// ============================================================================
// TableTap — ¿se puede leer la pantalla?
//
// Los tests dicen que el componente existe; no dicen que un humano pueda leerlo.
// Esto abre cada pantalla en un navegador de verdad, en teléfono y en
// escritorio, y falla si el texto se aplasta, se encima o se sale de la hoja.
//
//   pnpm layout          (dev)
//   pnpm layout --prod
// ============================================================================
import { join } from "node:path";
import { chromium } from "playwright";
import { AUDIT } from "./layout-audit.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

const { data: r } = await admin
  .from("restaurants").select("id").eq("name", "Demo Bistro").maybeSingle();
// Una mesa libre: una con cuenta abierta abre el seguimiento del pedido, no el
// menú, y entonces no hay carrito que revisar — que es justo la pantalla que
// se fue rota a producción.
const { data: tables } = await admin
  .from("restaurant_tables").select("id").eq("restaurant_id", r.id);
const { data: busy } = await admin
  .from("orders").select("table_id").eq("restaurant_id", r.id).eq("paid", false);
const taken = new Set((busy ?? []).map(o => o.table_id));
const table = tables.find(t => !taken.has(t.id)) ?? tables[0];

// El teléfono primero: es donde come el cliente y donde cobra el mesero.
const SIZES = [
  { name: "teléfono", width: 390, height: 844 },
  { name: "escritorio", width: 1280, height: 900 },
];

const PAGES = [
  { path: `/r/${r.id}`, auth: false },
  { path: `/r/${r.id}/t/${table.id}`, auth: false, cart: true },
  { path: "/dashboard", auth: true },
  { path: "/dashboard/orders", auth: true },
  { path: "/dashboard/bills", auth: true },
  { path: "/dashboard/tables", auth: true },
  { path: "/dashboard/analytics", auth: true },
  { path: "/dashboard/promotions", auth: true },
  { path: "/dashboard/settings", auth: true },
  { path: "/dashboard/staff", auth: true },
  { path: "/dashboard/plan", auth: true },
  { path: "/dashboard/profile", auth: true },
];

const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { data: session } = await auth.auth.signInWithPassword({
  email: "demo@tabletap.dev",
  password: "demo123",
});
const cookie = {
  name: `sb-${ref}-auth-token`,
  value: `base64-${Buffer.from(JSON.stringify(session.session)).toString("base64")}`,
  url: BASE,
};

let failed = 0;
const browser = await chromium.launch();
console.log(`\nEstilos — ${prod ? "production" : "development"}\n`);

for (const size of SIZES) {
  console.log(`  ${size.name} (${size.width}px)`);
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    locale: "es-MX",
  });
  await context.addCookies([cookie]);

  for (const page of PAGES) {
    const tab = await context.newPage();
    try {
      // "networkidle" nunca llega en las pantallas con tiempo real: la
      // suscripción deja la conexión abierta a propósito. Se espera a que
      // cargue y luego a que se asiente.
      await tab.goto(BASE + page.path, { waitUntil: "load", timeout: 30000 });
      await tab.waitForTimeout(1500);
      // El carrito es donde el cliente decide pagar, así que se revisa lleno:
      // una fila vacía nunca se aplasta, y aplastada fue como se fue a prod.
      if (page.cart) {
        // Se pulsa desde la página: el clic de Playwright espera a que el
        // elemento deje de moverse y aquí siempre hay algo animándose, así que
        // caducaba sin que el botón tuviera nada malo.
        const tap = sel => tab.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e) e.click(); return !!e;})()`);
        await tap("button[aria-label^='Agregar ']");
        await tab.waitForTimeout(500);
        // Un platillo con opciones abre su ficha en lugar de caer al carrito.
        await tab.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Agregar al carrito/.test(x.textContent)); if(b) b.click();})()`);
        await tab.waitForSelector(".tt-fab", { timeout: 8000 });
        await tap(".tt-fab");
        await tab.waitForTimeout(700);
        // El pie va fijo: sin bajar del todo, los totales no se han pintado.
        await tab.evaluate(`(()=>{const o=document.querySelector('.tt-detail-overlay'); if(o) o.scrollTop=o.scrollHeight;})()`);
        await tab.waitForTimeout(300);
      }
      const faults = await tab.evaluate(AUDIT);
      if (faults.length === 0) {
        console.log(`    ok       ${page.path}${page.cart ? " (carrito)" : ""}`);
      } else {
        failed += faults.length;
        console.log(`    MAL      ${page.path}${page.cart ? " (carrito)" : ""}`);
        for (const f of faults) console.log(`             ${f.kind}: «${f.text}» (${f.w}px)`);
      }
    } catch (e) {
      failed++;
      console.log(`    MAL      ${page.path}: ${e.message.split("\n")[0]}`);
    }
    await tab.close();
  }
  await context.close();
  console.log("");
}

await browser.close();
console.log(failed === 0 ? "Todo se lee.\n" : `${failed} PROBLEMA(S) de lectura.\n`);
process.exit(failed === 0 ? 0 : 1);
