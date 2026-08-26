// ============================================================================
// Una impresora CloudPRNT de mentira.
//
// No tenemos el aparato, así que esto se comporta como él: sondea, pide el
// trabajo, dice que lo imprimió. Prueba NUESTRO lado del contrato entero —la
// cola, el token, el reintento— y no prueba absolutamente nada sobre el
// firmware de Star. Ver docs/printing.md.
//
//   pnpm print:sim <token>
// ============================================================================
import { join } from "node:path";

const token = process.argv[2];
if (!token) {
  console.error("\n  Uso: pnpm print:sim <token>\n  (lo da Ajustes al agregar una impresora)\n");
  process.exit(1);
}
process.loadEnvFile(join(process.cwd(), ".env.development.local"));
const BASE = process.env.PRINT_SIM_BASE ?? "http://localhost:3000";
const URL_ = `${BASE}/api/print/cloudprnt/${token}`;
const EVERY_MS = 3000;

console.log(`\nImpresora simulada · sondeando ${URL_}\n`);

async function tick() {
  const ask = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printerMAC: "00:11:22:33:44:55", status: "ready", statusCode: "200 OK" }),
  });
  if (!ask.ok) return console.log(`  sondeo → ${ask.status}`);
  const { jobReady } = await ask.json();
  if (!jobReady) return;

  const job = await fetch(`${URL_}?type=text/plain`);
  const slip = await job.text();
  console.log("\n┌─── COMANDA ───────────────────────────────");
  for (const line of slip.split("\n")) console.log("│ " + line);
  console.log("└───────────────────────────────────────────\n");

  await fetch(URL_, { method: "DELETE" });
  console.log("  (impresa)");
}

setInterval(() => void tick().catch(e => console.log("  error:", e.message)), EVERY_MS);
void tick();
