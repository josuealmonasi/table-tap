import pg from "pg";
process.loadEnvFile(".env.development.local");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`
  select p.proname, p.prosecdef,
         pg_get_function_identity_arguments(p.oid) args,
         array_to_string(p.proconfig, ',') config,
         (select string_agg(distinct a.rolname, ',')
            from pg_proc pp, lateral aclexplode(pp.proacl) ae
            join pg_roles a on a.oid = ae.grantee
           where pp.oid = p.oid and ae.privilege_type='EXECUTE') grantees
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prokind='f'
   order by p.prosecdef desc, p.proname`);
console.log("fn".padEnd(34), "secdef", "search_path".padEnd(16), "who may EXECUTE");
for (const r of rows) {
  const risky = r.prosecdef && !(r.config ?? "").includes("search_path");
  console.log(
    `${r.proname}(${r.args})`.slice(0, 33).padEnd(34),
    String(r.prosecdef).padEnd(6),
    (r.config ?? "— NONE").replace("search_path=", "").padEnd(16),
    (r.grantees ?? "public").padEnd(30),
    risky ? "◀ SECDEF WITHOUT PINNED search_path" : "",
  );
}
await c.end();
