import { describe, expect, it, vi } from "vitest";
import { captureOrdersAccess, compareOrdersAccess, developmentConfig } from "../../../scripts/probe-orders-rls-equivalence.mjs";

const emails = ["demo@tabletap.dev", "demo-manager@tabletap.dev", "demo-cashier@tabletap.dev",
  "demo-waiter@tabletap.dev", "demo-kitchen@tabletap.dev"];
const tables = ["orders", "service_requests", "kitchen_tickets", "kitchen_requests"];

function database(failRead = false) {
  let role = "postgres", id: string | null = null;
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith("rollback to")) { role = "postgres"; id = null; }
    if (sql.startsWith("set local role")) role = sql.endsWith(" anon") ? "anon" : "authenticated";
    if (sql.includes("set_config('request.jwt.claim.sub'")) {
      id = JSON.parse(String(args[2])).sub;
      expect(args.slice(0, 2)).toEqual([id ?? "", role]);
    }
    let rows: unknown[] = [];
    if (sql.includes("c.relrowsecurity")) rows = tables.map(relname => ({ relname, relrowsecurity: true }));
    else if (sql.includes("from pg_policies")) rows = [{ qual: "old or new policy" }];
    else if (sql.includes("select exists(select 1 from auth.users")) rows = [{ present: false }];
    else if (sql.includes("from auth.users where email")) rows = emails.map((email, i) => ({ id: `user-${i}`, email }));
    else if (sql.includes("join auth.users")) rows = [{ id: "demo-restaurant" }];
    else if (sql.includes("from auth.users u")) rows = [{ id: "admin-id", email: "admin@tabletap.dev" }];
    else if (sql.includes("select current_user")) rows = [{ role, id }];
    else if (sql.includes("has_table_privilege")) rows = [{ allowed: role !== "anon" }];
    else if (sql.includes("count(*)::int")) {
      if (failRead && role === "authenticated") throw new Error("read failed");
      rows = [{ count: role === "postgres" ? 20 : 5, fingerprint: role === "postgres" ? "all" : id }];
    } else if (sql.includes("jsonb_build_array")) rows = [{ fingerprint: "membership" }];
    else if (sql.startsWith("explain")) rows = [{ "QUERY PLAN": [{ Plan: { "Node Type": "Index Scan" } }] }];
    return { rows };
  });
  return { query };
}

describe("the orders equivalence probe", () => {
  it("reads all four tables as each login and rolls back every identity", async () => {
    const db = database(), snapshot = await captureOrdersAccess(db, true);
    expect(db.query.mock.calls[0][0]).toBe("begin isolation level repeatable read read only");
    expect(db.query.mock.calls.at(-1)?.[0]).toBe("rollback");
    expect(snapshot.results).toHaveLength(9);
    expect(snapshot.results[0].visible.orders).toEqual({ count: 5, fingerprint: "user-0" });
    expect(snapshot.results.at(-1)?.visible.orders).toEqual({ denied: true });
    expect(db.query.mock.calls.filter(([sql]) => sql === "rollback to savepoint actor")).toHaveLength(9);
    expect(db.query.mock.calls.filter(([sql]) => sql.startsWith("explain"))).toHaveLength(8);
    expect(db.query.mock.calls.map(([sql]) => sql).join("\n")).not.toMatch(/\b(insert|update|delete|create|alter|grant|revoke|commit)\b/i);
  });

  it("rolls back the actor and transaction after a failed read", async () => {
    const db = database(true);
    await expect(captureOrdersAccess(db)).rejects.toThrow("read failed");
    expect(db.query.mock.calls.slice(-3).map(([sql]) => sql)).toEqual([
      "rollback to savepoint actor", "release savepoint actor", "rollback",
    ]);
  });

  it("allows policy and plan changes only when counts and row identities agree", async () => {
    const snapshot = await captureOrdersAccess(database());
    const after = structuredClone(snapshot);
    after.policies = [];
    expect(() => compareOrdersAccess(snapshot, after)).not.toThrow();
    const orders = after.results[0].visible.orders;
    if (!("fingerprint" in orders)) throw new Error("Expected a readable orders snapshot");
    orders.fingerprint = "another-tenant-row";
    expect(() => compareOrdersAccess(snapshot, after)).toThrow("Visible rows changed");
  });

  it("refuses a comparison after a fixture reset or membership change", async () => {
    const snapshot = await captureOrdersAccess(database());
    const after = structuredClone(snapshot);
    after.dataset.orders.count++;
    expect(() => compareOrdersAccess(snapshot, after)).toThrow("Fixtures changed");
    after.dataset = snapshot.dataset;
    after.membership.fingerprint = "someone-joined";
    expect(() => compareOrdersAccess(snapshot, after)).toThrow("Membership changed");
  });

  it("refuses production, unknown projects and mismatched connections", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://dev-project.supabase.co", DATABASE_URL: "postgres://postgres.dev-project@pool/postgres" };
    expect(developmentConfig(env, []).ssl).toEqual({ rejectUnauthorized: false });
    expect(() => developmentConfig(env, ["--prod"])).toThrow("Refusing");
    expect(() => developmentConfig({ ...env, NODE_ENV: "production" }, [])).toThrow("Refusing");
    expect(() => developmentConfig({ ...env, DATABASE_URL: "" }, [])).toThrow("Refusing");
    expect(() => developmentConfig({ ...env, DATABASE_URL: "postgres://another-project" }, [])).toThrow("differ");
    expect(() => developmentConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://vayymkzrvlepoksualku.supabase.co",
      DATABASE_URL: "postgres://postgres.vayymkzrvlepoksualku@pool/postgres" }, [])).toThrow("Refusing");
  });
});
