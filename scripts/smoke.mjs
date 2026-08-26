// ============================================================================
// TableTap — smoke test: does every page actually render for a real user?
//
// Written after shipping three "it works" claims that were checked one page at
// a time, while a neighbouring page was blank. It signs in for real, walks
// every dashboard route and a customer menu, and fails on anything that comes
// back an error page, a redirect to login, or a page with no content in it.
//
//   pnpm smoke          (dev)
//   pnpm smoke --prod   (against the deployed site)
// ============================================================================
import { join } from "node:path";
import { requireServer } from "./preflight.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));

const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

await requireServer(BASE, prod);

const { createClient } = await import("@supabase/supabase-js");

const EMAIL = process.env.SMOKE_EMAIL ?? "demo@tabletap.dev";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "demo123";

const auth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
if (signInError) {
  console.log(`\n  FAILED  cannot sign in as ${EMAIL}: ${signInError.message}\n`);
  process.exit(1);
}

// Supabase's SSR client reads the session from a cookie named for the project.
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const session = signedIn.session;
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(
  JSON.stringify(session),
).toString("base64")}`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { data: restaurant } = await admin
  .from("restaurants")
  .select("id")
  .eq("owner_id", session.user.id)
  .maybeSingle();
const { data: table } = await admin
  .from("restaurant_tables")
  .select("id")
  .eq("restaurant_id", restaurant?.id ?? "")
  .limit(1)
  .maybeSingle();

const PAGES = [
  "/dashboard",
  "/dashboard/orders",
  "/dashboard/tables",
  "/dashboard/bills",
  "/dashboard/promotions",
  "/dashboard/analytics",
  "/dashboard/settings",
  "/dashboard/staff",
  "/dashboard/plan",
  "/dashboard/profile",
  restaurant ? `/r/${restaurant.id}` : null,
  restaurant && table ? `/r/${restaurant.id}/t/${table.id}` : null,
].filter(Boolean);

console.log(`\nSmoke test — ${BASE} as ${EMAIL}\n`);
let failed = false;

for (const page of PAGES) {
  try {
    const res = await fetch(BASE + page, {
      headers: { cookie, "accept-language": "es-MX", accept: "text/html" },
      redirect: "manual",
    });
    const html = res.status < 300 ? await res.text() : "";
    const problems = [];

    if (res.status >= 300 && res.status < 400) problems.push(`redirected to ${res.headers.get("location")}`);
    else if (res.status !== 200) problems.push(`status ${res.status}`);
    if (/Iniciar sesión|Bienvenido de nuevo/.test(html)) problems.push("bounced to login");
    if (/Application error|client-side exception/.test(html)) problems.push("error boundary");
    // Chrome alone is a few kB; a real page carries far more than that.
    if (html && html.length < 20_000) problems.push(`suspiciously empty (${html.length} bytes)`);

    if (problems.length > 0) {
      failed = true;
      console.log(`  FAILED   ${page}\n           ${problems.join("; ")}`);
    } else {
      console.log(`  ok       ${page}`);
    }
  } catch (err) {
    failed = true;
    console.log(`  FAILED   ${page}\n           ${err.message}`);
  }
}

console.log(failed ? "\nSome pages do not render.\n" : "\nEvery page renders.\n");
process.exit(failed ? 1 : 0);
