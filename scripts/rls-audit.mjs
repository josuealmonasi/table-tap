// ============================================================================
// TableTap — el panorama de permisos, para revisarlo con los ojos.
//
// `pnpm rls` afirma cosas concretas y falla si dejan de ser ciertas. Esto no
// afirma nada: imprime cómo está la base ahora mismo —qué tabla tiene RLS, qué
// puede leer cada rol, qué política deja pasar qué— para que una revisión mire
// el estado real y no el archivo de esquema, que es lo que uno *cree* que
// aplicó. Así apareció que `authenticated` tenía SELECT sobre toda la tabla
// `restaurants` mientras su política decía `using (true)`.
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
  "— cualquiera con la llave pública las lee enteras");

await show("Tablas con RLS y sin política", `
  select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)
   order by 1`, "— niegan todo, que suele ser lo correcto");

await show("Lo que ve anon", `
  select table_name, string_agg(distinct column_name, ', ' order by column_name)
    from information_schema.role_column_grants
   where grantee='anon' and table_schema='public' and privilege_type='SELECT'
   group by table_name order by 1`);

await show("Lo que ve authenticated", `
  select table_name, string_agg(distinct coalesce(column_name,'TABLA ENTERA'), ', ')
    from information_schema.role_column_grants
   where grantee='authenticated' and table_schema='public' and privilege_type='SELECT'
   group by table_name order by 1`,
  "— ojo con las tablas enteras cuya política sea using (true)");

await show("Políticas que dejan pasar cualquier fila", `
  select tablename, cmd, policyname from pg_policies
   where schemaname='public' and (qual='true' or with_check='true') order by 1,2`,
  "— sólo son seguras si el permiso de columnas las acota");

await show("Funciones security definer", `
  select p.proname,
         coalesce(array_to_string(p.proconfig,','),'SIN search_path ⚠') ,
         coalesce((select string_agg(r.rolname, ',') from pg_roles r
                    where has_function_privilege(r.rolname, p.oid, 'EXECUTE')
                      and r.rolname in ('anon','authenticated','service_role')), 'nadie')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef order by 1`,
  "— corren como su dueño: search_path fijo y sólo quien deba ejecutarlas");

await c.end();
console.log("");
