// ============================================================================
// The environment a GitHub gate job runs with — and nothing else.
//
//   supabase status -o env --workdir ci | node scripts/ci-env.mjs
//
// Every gate reads `.env.development.local`. On a laptop that file points at
// the shared dev project; in CI it must point at the throwaway Supabase stack
// the job started on its own runner, and nowhere else. So this writes it from
// what `supabase status` reports and refuses, before writing anything, when:
//   - it is not running on GitHub Actions (a laptop already has its file, and
//     overwriting it would point that checkout at a stack that is not there);
//   - the file already exists;
//   - the API or the database is anywhere but this machine's loopback.
//
// The logins' passwords are made up here, fresh per job: the stack lives for
// one job, so there is nothing to keep secret past it and no repository
// secret is needed. Stripe is the one outside service a gate reaches. With a
// test key in STRIPE_TEST_SECRET it is used; without one the key is a
// placeholder and GATE_NO_STRIPE=1 tells the gates to SKIP — visibly, by
// name — the cases that need Stripe, rather than report them as passed.
//
// The values also go to $GITHUB_ENV, so `next build` and `next start` (which
// read .env.production.local in production mode, never this file) see the
// same ones: Next never overrides a variable already in the environment.
// ============================================================================
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ENV_FILE = ".env.development.local";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Whether a URL points at this machine and nowhere else. */
export function isLoopback(url) {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * `KEY="value"` lines, as `supabase status -o env` prints them.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseStatus(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

const secret = () => randomBytes(18).toString("base64url");

/**
 * The variables for one CI job, from the local stack's status.
 * Throws instead of returning anything that could reach another database.
 */
export function ciEnv(status, { stripeKey = "", makeSecret = secret } = {}) {
  const url = status.API_URL;
  const db = status.DB_URL;
  if (!isLoopback(url)) throw new Error(`API_URL is not a local stack: ${url ?? "missing"}`);
  if (!isLoopback(db)) throw new Error(`DB_URL is not a local stack: ${db ? new URL(db).host : "missing"}`);
  // The JWT keys every supabase-js version and every local service accept.
  const publishable = status.ANON_KEY || status.PUBLISHABLE_KEY;
  const secretKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!publishable || !secretKey) {
    throw new Error(`supabase status gave no API keys (it gave: ${Object.keys(status).join(", ") || "nothing"})`);
  }
  if (stripeKey && !stripeKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_TEST_SECRET must be a Stripe TEST key (sk_test_…); refusing anything else");
  }
  // The local database speaks plain TCP. The scripts ask for TLS; sslmode in
  // the URL wins over that in node-postgres.
  const database = new URL(db);
  database.searchParams.set("sslmode", "disable");
  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
    SUPABASE_SECRET_KEY: secretKey,
    DATABASE_URL: database.toString(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_ci",
    STRIPE_SECRET_KEY: stripeKey || "sk_test_ci_no_stripe_key",
    STRIPE_WEBHOOK_SECRET: `whsec_${makeSecret()}`,
    STRIPE_WEBHOOK_SECRET_CONNECT: `whsec_${makeSecret()}`,
    GATE_NO_STRIPE: stripeKey ? "" : "1",
    CRON_SECRET: makeSecret(),
    PLATFORM_ADMIN_EMAIL: "admin@tabletap.shop",
    PLATFORM_ADMIN_PASSWORD: makeSecret(),
    DEMO_PASSWORD: makeSecret(),
    TEST_PASSWORD: makeSecret(),
  };
}

/** Values that must never show up in a job log. */
export const MASKED = [
  "SUPABASE_SECRET_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_CONNECT",
  "CRON_SECRET", "PLATFORM_ADMIN_PASSWORD", "DEMO_PASSWORD", "TEST_PASSWORD",
];

/**
 * Write the file (and $GITHUB_ENV), or refuse. Returns the variables.
 * @param {{ status: Record<string, string>, env?: Record<string, string | undefined>, root?: string, log?: (line: string) => void }} options
 */
export function writeCiEnv({ status, env = process.env, root = process.cwd(), log = console.log }) {
  if (env.GITHUB_ACTIONS !== "true") {
    throw new Error("ci-env only runs on GitHub Actions; on a laptop .env.development.local is yours to keep");
  }
  const file = path.join(root, ENV_FILE);
  if (fs.existsSync(file)) throw new Error(`${ENV_FILE} already exists; refusing to overwrite it`);
  const vars = ciEnv(status, { stripeKey: env.STRIPE_TEST_SECRET ?? "" });
  for (const name of MASKED) if (vars[name]) log(`::add-mask::${vars[name]}`);
  const body = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs.writeFileSync(file, body, { mode: 0o600 });
  if (env.GITHUB_ENV) fs.appendFileSync(env.GITHUB_ENV, body);
  log(`Wrote ${ENV_FILE} for the local stack at ${vars.NEXT_PUBLIC_SUPABASE_URL}.`);
  log(vars.GATE_NO_STRIPE ? "skipped: no STRIPE_TEST_SECRET — cases that reach Stripe will be skipped by name." : "Stripe: using the STRIPE_TEST_SECRET test key.");
  return vars;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    writeCiEnv({ status: parseStatus(fs.readFileSync(0, "utf8")) });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
