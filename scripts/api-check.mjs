// ============================================================================
// TableTap — ¿de verdad funciona cada petición?
//
// Lo que ya teníamos comprobaba el borde: `rls` a quién se le niega, `roles`
// quién abre cada pantalla, `invariants` que cada ruta tenga guardia, `layout`
// que se pueda leer, `smoke` que la página pinte. Ninguno llamaba a un endpoint
// con una petición legítima para ver si hace su trabajo. Este sí, a los 34.
//
// Un 500 nunca está bien. Una negativa concreta —409 sin cuenta de Stripe, 400
// por falta de datos— es la ruta funcionando, y por eso `expect` es una lista.
//
//   pnpm api
//   pnpm api --prod
// ============================================================================
import { join } from "node:path";
import { setup, teardown } from "./api-fixtures.mjs";
import { cases } from "./api-cases.mjs";
import { requireServer, retryFetch } from "./preflight.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

await requireServer(BASE, prod);

let failed = 0;
const ok = m => console.log(`    ok       ${m}`);
const bad = m => { failed++; console.log(`    MAL      ${m}`); };

console.log(`\nPeticiones — ${prod ? "production" : "development"}\n`);

const fx = await setup(process.env, BASE);
// Lo que un caso deja para el siguiente: el cupón que se crea es el que luego
// se apaga y se borra.
const saved = {};
try {
  for (const c of cases(fx)) {
    const headers = { "Content-Type": "application/json" };
    if (c.as !== "diner") headers.cookie = fx.who[c.as];

    let res, text;
    try {
      res = await retryFetch(
        BASE + c.path,
        {
          method: c.method,
          headers,
          body:
            c.body === undefined
              ? undefined
              : JSON.stringify(typeof c.body === "function" ? await c.body(fx, saved) : c.body),
        },
        BASE,
      );
      text = await res.text();
    } catch (e) {
      bad(`${c.name} — no respondió: ${e.message}`);
      continue;
    }

    if (!c.expect.includes(res.status)) {
      // Algunas rutas dependen de algo que aún no está contratado. Se avisa en
      // cada corrida y no se tumba el chequeo: una prueba que siempre está en
      // rojo por algo que no se puede arreglar desde el código es una prueba
      // que se ignora, y entonces tapa las que sí importan.
      if (c.known) {
        console.log(`    –        ${c.name} — ${c.known} (${res.status})`);
        continue;
      }
      bad(`${c.name} — ${res.status}, esperaba ${c.expect.join("/")}  ${text.slice(0, 90)}`);
      continue;
    }

    // El estado correcto con el cuerpo equivocado sigue siendo un fallo: por
    // ahí pasó un endpoint que devolvía 200 y `saved: 0`.
    if (c.check && res.status === 200) {
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      const verdict = c.check(data);
      if (verdict !== true) {
        bad(`${c.name} — respondió 200 pero ${verdict}`);
        continue;
      }
    }
    if (c.save && res.status === 200) {
      try { Object.assign(saved, c.save(JSON.parse(text))); } catch { /* sin cuerpo */ }
    }
    ok(`${c.name}${c.expect.length > 1 ? ` (${res.status})` : ""}`);
  }
} finally {
  await teardown(fx);
}

console.log(failed === 0 ? "\nTodas las peticiones responden.\n" : `\n${failed} PROBLEMA(S).\n`);
process.exit(failed === 0 ? 0 : 1);
