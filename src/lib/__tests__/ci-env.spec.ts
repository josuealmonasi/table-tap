import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ciEnv, isLoopback, parseStatus, writeCiEnv, ENV_FILE } from "../../../scripts/ci-env.mjs";
import { browserScope, CORE_PAGES, pagePattern } from "../../../scripts/gate-scope-ci.mjs";

/**
 * The GitHub gates write `.env.development.local` from the throwaway stack the
 * job started. Every gate trusts that file, so the one thing it must never do
 * is point anywhere but this machine — not the dev project, not production.
 */
const STATUS = `API_URL="http://127.0.0.1:54321"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ANON_KEY="anon.jwt"
SERVICE_ROLE_KEY="service.jwt"
PUBLISHABLE_KEY="sb_publishable_x"
SECRET_KEY="sb_secret_x"
`;

describe("the CI environment", () => {
  const dirs: string[] = [];
  const scratch = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-env-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("reads supabase status's env output", () => {
    expect(parseStatus(STATUS)).toMatchObject({ API_URL: "http://127.0.0.1:54321", ANON_KEY: "anon.jwt" });
  });

  it("only ever targets this machine", () => {
    expect(isLoopback("http://127.0.0.1:54321")).toBe(true);
    expect(isLoopback("postgresql://postgres:p@localhost:54322/postgres")).toBe(true);
    expect(isLoopback("https://abcd.supabase.co")).toBe(false);
    expect(isLoopback("postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres")).toBe(false);
    expect(isLoopback("http://127.0.0.1.attacker.example")).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it("refuses a hosted API or database", () => {
    const status = parseStatus(STATUS);
    expect(() => ciEnv({ ...status, API_URL: "https://abcd.supabase.co" })).toThrow(/not a local stack/);
    expect(() => ciEnv({ ...status, DB_URL: "postgresql://u:p@db.abcd.supabase.co:5432/postgres" })).toThrow(/not a local stack/);
    expect(() => ciEnv({ API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://u:p@127.0.0.1:54322/postgres" })).toThrow(/no API keys/);
  });

  it("makes fresh passwords per run and turns TLS off for the local database", () => {
    const a = ciEnv(parseStatus(STATUS));
    const b = ciEnv(parseStatus(STATUS));
    expect(a.DEMO_PASSWORD).not.toBe(b.DEMO_PASSWORD);
    expect(a.TEST_PASSWORD).not.toBe(a.DEMO_PASSWORD);
    expect(a.DEMO_PASSWORD.length).toBeGreaterThanOrEqual(20);
    expect(new URL(a.DATABASE_URL).searchParams.get("sslmode")).toBe("disable");
    expect(a.SUPABASE_SECRET_KEY).toBe("service.jwt");
  });

  it("says when Stripe is missing instead of pretending it is there", () => {
    expect(ciEnv(parseStatus(STATUS)).GATE_NO_STRIPE).toBe("1");
    const withKey = ciEnv(parseStatus(STATUS), { stripeKey: "sk_test_abc" });
    expect(withKey.GATE_NO_STRIPE).toBe("");
    expect(withKey.STRIPE_SECRET_KEY).toBe("sk_test_abc");
    expect(() => ciEnv(parseStatus(STATUS), { stripeKey: "sk_live_abc" })).toThrow(/TEST key/);
  });

  it("refuses to run off GitHub Actions, or over an existing file", () => {
    const root = scratch();
    const status = parseStatus(STATUS);
    expect(() => writeCiEnv({ status, env: {}, root, log: () => {} })).toThrow(/only runs on GitHub Actions/);
    fs.writeFileSync(path.join(root, ENV_FILE), "DATABASE_URL=mine\n");
    expect(() => writeCiEnv({ status, env: { GITHUB_ACTIONS: "true" }, root, log: () => {} })).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(root, ENV_FILE), "utf8")).toBe("DATABASE_URL=mine\n");
  });

  it("writes the file and $GITHUB_ENV, and masks every secret in the log", () => {
    const root = scratch();
    const githubEnv = path.join(root, "github-env");
    const lines: string[] = [];
    const vars = writeCiEnv({
      status: parseStatus(STATUS),
      env: { GITHUB_ACTIONS: "true", GITHUB_ENV: githubEnv },
      root,
      log: (l: string) => lines.push(l),
    });
    const written = fs.readFileSync(path.join(root, ENV_FILE), "utf8");
    expect(written).toBe(fs.readFileSync(githubEnv, "utf8"));
    expect(written).toContain("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n");
    expect(lines).toContain(`::add-mask::${vars.DEMO_PASSWORD}`);
    expect(lines).toContain(`::add-mask::${vars.SUPABASE_SECRET_KEY}`);
    expect(lines.some(l => l.startsWith("skipped: no STRIPE_TEST_SECRET"))).toBe(true);
  });
});

describe("the browser gates' scope on GitHub", () => {
  it("skips a gate the change cannot reach, and says why", () => {
    expect(browserScope({ run: false, why: "no change reaches a page" })).toEqual({
      run: false,
      pages: [],
      why: "no change reaches a page",
    });
  });

  it("runs on the pages in reach when the plan names them", () => {
    const s = browserScope({ run: true, why: "2 page(s) in reach", scope: { GATE_PAGES: ["^/dashboard/pos$"] } });
    expect(s).toEqual({ run: true, pages: ["^/dashboard/pos$"], why: "2 page(s) in reach" });
  });

  it("caps a change that reaches everything to the core screens", () => {
    const s = browserScope({ run: true, why: "src/middleware.ts reaches everything", scope: {} });
    expect(s.run).toBe(true);
    expect(s.pages).toEqual(CORE_PAGES);
    expect(s.why).toMatch(/capped to the core screens/);
  });

  it("a capped run still opens every page the change adds or edits (#703's two-step page was capped out)", () => {
    const s = browserScope({ run: true, why: "its own script changed", scope: {} }, "plan", ["^/dashboard/admin/mfa$", CORE_PAGES[0]]);
    expect(s.pages).toEqual([...CORE_PAGES, "^/dashboard/admin/mfa$"]);
    expect(s.why).toMatch(/plus 1 changed page/);
    expect(pagePattern("src/app/dashboard/admin/restaurants/[id]/page.tsx")).toBe("^/dashboard/admin/restaurants/[^/]+$");
    expect(pagePattern("src/app/(public)/r/[restaurantId]/page.tsx")).toBe("^/r/[^/]+$");
    expect(pagePattern("src/lib/admin.ts")).toBeNull();
  });

  it("runs the core screens on request whatever the plan says", () => {
    expect(browserScope({ run: false, why: "nothing" }, "core").pages).toEqual(CORE_PAGES);
  });

  it("only names pages a browser gate can match", () => {
    for (const source of CORE_PAGES) expect(() => new RegExp(source)).not.toThrow();
    expect(CORE_PAGES.some(p => new RegExp(p).test("/r/abc/t/def"))).toBe(true);
  });
});
