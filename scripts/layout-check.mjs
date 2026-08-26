// ============================================================================
// TableTap — ¿se puede leer la pantalla?
//
// Los tests dicen que el componente existe; no dicen que un humano pueda
// leerlo. Esto abre cada pantalla en un navegador de verdad —con cada rol del
// equipo, en teléfono y en escritorio, y abriendo los diálogos— y falla si el
// texto se aplasta, se encima, se sale de la hoja o dos tarjetas no coinciden.
//
//   pnpm layout          (dev)
//   pnpm layout --prod
// ============================================================================
import { join } from "node:path";
import { chromium } from "playwright";
import { AUDIT } from "./layout-audit.mjs";
import { CREW, DIALOGS, DINER } from "./layout-paths.mjs";
import { requireServer } from "./preflight.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

await requireServer(BASE, prod);

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

const { data: r } = await admin
  .from("restaurants").select("id").eq("name", "Demo Bistro").maybeSingle();
// Una mesa libre: una con cuenta abierta abre el seguimiento del pedido, no el
// menú, y entonces no hay carrito que revisar.
const { data: tables } = await admin
  .from("restaurant_tables").select("id").eq("restaurant_id", r.id);
const { data: busy } = await admin
  .from("orders").select("table_id").eq("restaurant_id", r.id).eq("paid", false);
const taken = new Set((busy ?? []).map(o => o.table_id));
const table = tables.find(t => !taken.has(t.id)) ?? tables[0];

const SIZES = [
  { name: "teléfono", width: 390, height: 844 },
  { name: "escritorio", width: 1280, height: 900 },
];

let failed = 0;
const ok = m => console.log(`    ok       ${m}`);
const bad = (where, faults) => {
  failed += faults.length;
  console.log(`    MAL      ${where}`);
  for (const f of faults) console.log(`             ${f.kind}: «${f.text}» (${f.w}px)`);
};

/**
 * Una navegación que reintenta una vez.
 *
 * El servidor de desarrollo se cae a media revisión y el fallo de red salía
 * como si la pantalla estuviera rota. Un rojo falso enseña a ignorar los rojos.
 */
async function gotoOnce(tab, url, opts) {
  try {
    return await tab.goto(url, opts);
  } catch {
    await tab.waitForTimeout(2000);
    return await tab.goto(url, opts);
  }
}

/** Espera a que haya contenido de verdad: cargar no es tener qué medir. */
async function settle(tab) {
  await tab.waitForFunction("document.body.innerText.trim().length > 200", null, {
    timeout: 30000,
  });
  await tab.waitForTimeout(900);
}

/** Pulsa desde la página: el clic de Playwright espera a que nada se mueva. */
const tap = (tab, sel) =>
  tab.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e){e.click(); return true;} return false;})()`);

const tapText = (tab, text) =>
  tab.evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(b){b.click(); return true;} return false;})()`);

async function look(tab, where) {
  const faults = await tab.evaluate(AUDIT);
  if (faults.length === 0) ok(where);
  else bad(where, faults);
}

const cookieFor = async email => {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const { data } = await auth.auth.signInWithPassword({ email, password: "demo123" });
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`,
    url: BASE,
  };
};

const browser = await chromium.launch();
console.log(`\nEstilos — ${prod ? "production" : "development"}\n`);

for (const size of SIZES) {
  console.log(`  ${size.name} (${size.width}px)\n`);

  // ── El comensal ──────────────────────────────────────────────────────────
  // En los dos idiomas: el inglés es más largo en unos rótulos y más corto en
  // otros, y el carrito ya se rompió una vez por un rótulo que no cabía. El
  // panel se revisa sólo en español, que es donde trabaja el equipo.
  for (const lang of ["es", "en"]) {
  const diner = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    locale: lang === "es" ? "es-MX" : "en-US",
  });
  // El idioma es del restaurante, no del teléfono: la app arranca en español
  // pase lo que pase y sólo la cookie lo cambia. Ponerle `locale` al navegador
  // y creer que ya estaba en inglés era medir español dos veces.
  await diner.addCookies([{ name: "tt-locale", value: lang, url: BASE }]);
  for (const flow of DINER) {
    const tab = await diner.newPage();
    try {
      await gotoOnce(tab, `${BASE}/r/${r.id}/t/${table.id}`, { waitUntil: "load", timeout: 60000 });
      await settle(tab);
      for (const step of flow.steps) {
        if (step.addToCart) {
          await tap(tab, lang === "es"
            ? "button[aria-label^='Agregar ']"
            : "button[aria-label^='Add ']");
          await tab.waitForTimeout(500);
          await tab.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Agregar al carrito|Add to (cart|order)/i.test(x.textContent)); if(b) b.click();})()`);
          await tab.waitForSelector(".tt-fab", { timeout: 8000 });
        }
        // Un paso que no encuentra su botón deja la pantalla anterior en
        // pantalla, y entonces se mide dos veces el menú creyendo que se
        // revisó la ficha. Eso no se calla.
        if (step.click) {
          const sel = typeof step.click === "string" ? step.click : step.click[lang];
          if (!(await tap(tab, sel))) throw new Error(`no encontró «${sel}»`);
        }
        if (step.text) {
          const label = typeof step.text === "string" ? step.text : step.text[lang];
          if (!(await tapText(tab, label))) {
            throw new Error(`no encontró el botón «${label}»`);
          }
        }
        if (step.bottom) {
          await tab.evaluate(`(()=>{const o=document.querySelector('.tt-detail-overlay'); if(o) o.scrollTop=o.scrollHeight;})()`);
        }
        await tab.waitForTimeout(700);
      }
      if (flow.expect?.[lang]) {
        const there = await tab.evaluate(
          `document.body.innerText.includes(${JSON.stringify(flow.expect[lang])})`,
        );
        if (!there) throw new Error(`no llegó — falta «${flow.expect[lang]}»`);
      }
      await look(tab, `comensal ${lang} · ${flow.name}`);
    } catch (e) {
      failed++;
      console.log(`    MAL      comensal ${lang} · ${flow.name}: ${e.message.split("\n")[0]}`);
    }
    await tab.close();
  }
  await diner.close();
  }

  // ── El equipo ────────────────────────────────────────────────────────────
  for (const who of CREW) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      locale: "es-MX",
    });
    await ctx.addCookies([await cookieFor(who.email)]);
    for (const path of who.pages) {
      const tab = await ctx.newPage();
      try {
        await gotoOnce(tab, BASE + path, { waitUntil: "load", timeout: 60000 });
        await settle(tab);
        await look(tab, `${who.role} · ${path}`);

        for (const dialog of DIALOGS[path] ?? []) {
          const clicked = dialog.text
            ? await tapText(tab, dialog.text)
            : await tap(tab, dialog.click);
          await tab.waitForTimeout(900);
          // Que se haya pulsado no quiere decir que algo se abriera. Un salto
          // callado se lee igual que un ok, y así fue como un rol entero se
          // quedó sin revisar sin que nada lo dijera.
          const open = await tab.evaluate("!!document.querySelector('[role=dialog]')");
          if (!clicked || !open) {
            console.log(`    –        ${who.role} · ${path} → ${dialog.name}: no abrió (sin datos)`);
            continue;
          }
          await look(tab, `${who.role} · ${path} → ${dialog.name}`);
          await tab.keyboard.press("Escape");
          await tab.waitForTimeout(400);
        }
      } catch (e) {
        failed++;
        console.log(`    MAL      ${who.role} · ${path}: ${e.message.split("\n")[0]}`);
      }
      await tab.close();
    }
    await ctx.close();
  }
  console.log("");
}

await browser.close();
console.log(failed === 0 ? "Todo se lee.\n" : `${failed} PROBLEMA(S) de lectura.\n`);
process.exit(failed === 0 ? 0 : 1);
