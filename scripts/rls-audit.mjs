// ============================================================================
// TableTap — the permission landscape, to be reviewed by eye.
//
// `pnpm rls` asserts specific things and fails when they stop being true. This
// asserts nothing: it prints how the database stands right now — which table
// has RLS, what each role can read, which policy lets what through — so a
// review looks at the real state and not at the schema file, which is what one
// *believes* was applied. That is how it surfaced that `authenticated` had
// SELECT on the whole `restaurants` table while its policy said `using (true)`.
//
//   pnpm rls:audit
//   pnpm rls:audit --prod
// ============================================================================
import { readFile } from "node:fs/promises";
import pg from "pg";

const prod = process.argv.includes("--prod");
const file = prod ? ".env.production.local" : ".env.development.local";
const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
const env = Object.fromEntries(
  text
    .split("\n")
    .filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const show = async (label, sql, note) => {
  const { rows } = await c.query(sql);
  console.log(`\n── ${label} (${rows.length}) ${note ?? ""}`);
  for (const r of rows) console.log("   ", Object.values(r).map(v => v ?? "—").join("  ·  "));
};

console.log(`\nPermisos — ${prod ? "production" : "development"}`);

await show("Tablas sin RLS", `
  select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity order by 1`,
  "— anyone with the public key reads them whole");

await show("Tables with RLS and no policy", `
  select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)
   order by 1`, "— they deny everything, which is usually right");

await show("What anon can see", `
  select table_name, string_agg(distinct column_name, ', ' order by column_name)
    from information_schema.role_column_grants
   where grantee='anon' and table_schema='public' and privilege_type='SELECT'
   group by table_name order by 1`);

await show("What authenticated can see", `
  select table_name, string_agg(distinct coalesce(column_name,'TABLA ENTERA'), ', ')
    from information_schema.role_column_grants
   where grantee='authenticated' and table_schema='public' and privilege_type='SELECT'
   group by table_name order by 1`,
  "— ojo con las tablas enteras cuya política sea using (true)");

await show("Policies that let any row through", `
  select tablename, cmd, policyname from pg_policies
   where schemaname='public' and (qual='true' or with_check='true') order by 1,2`,
  "— safe only if a column grant narrows them");

await show("Security definer functions", `
  select p.proname,
         coalesce(array_to_string(p.proconfig,','),'SIN search_path ⚠') ,
         coalesce((select string_agg(r.rolname, ',') from pg_roles r
                    where has_function_privilege(r.rolname, p.oid, 'EXECUTE')
                      and r.rolname in ('anon','authenticated','service_role')), 'nadie')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef order by 1`,
  "— they run as their owner: pinned search_path, executable only by who must");

await c.end();
console.log("");
