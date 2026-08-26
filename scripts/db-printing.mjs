// Aplica supabase/printing.sql. Separado de `pnpm db:create` porque esta rama
// vive sin fusionar y no debe tocar el esquema principal.
import { readFile } from "node:fs/promises";
import pg from "pg";

const prod = process.argv.includes("--prod");
const file = prod ? ".env.production.local" : ".env.development.local";
const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
const env = Object.fromEntries(
  text.split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const sql = await readFile(new URL("../supabase/printing.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`▸ [${prod ? "production" : "development"}] Impresión…`);
await client.query(sql);
await client.end();
console.log("✓ Listo.");
