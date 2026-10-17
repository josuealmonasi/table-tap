import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const table = schema.match(/create table if not exists restaurant_billing_operations \(([\s\S]*?)\);/)?.[1];
const functionSql = (name: string) => schema.match(new RegExp(`function public.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];

// Mocked routes cannot execute PostgreSQL's exclusion or privilege checks.
// These check the declared boundary; Claude runs the live RLS/concurrency gates.
it("retains one billing record per restaurant after deletion", () => {
  expect(table).toMatch(/restaurant_id uuid primary key/);
  expect(table).not.toMatch(/references restaurants|on delete cascade/);
  expect(functionSql("claim_restaurant_billing")).toMatch(/where restaurant_id = p_restaurant and token is null/);
  expect(functionSql("release_restaurant_billing")).not.toMatch(/delete from/);
});
it("takes over only the expired token and records Stripe's snapshot in the same transaction", () => {
  const takeover = functionSql("takeover_restaurant_billing");
  expect(takeover).toContain("token = p_previous");
  expect(takeover).toContain("started_at = p_started_at");
  expect(takeover).toContain("started_at <= now() - interval '15 minutes'");
  expect(takeover).toContain("public.record_restaurant_billing(p_restaurant, p_token, p_state)");
  expect(functionSql("record_restaurant_billing")).toContain("for update");
});
it("releases only the claim owned by the finishing request", () => {
  expect(functionSql("release_restaurant_billing")).toContain("restaurant_id = p_restaurant and token = p_token");
});
it("keeps billing records and all definer functions service-only", () => {
  expect(schema).toContain("alter table restaurant_billing_operations enable row level security;");
  expect(schema).toContain("revoke all on restaurant_billing_operations from anon, authenticated, public;");
  const signatures = {
    claim_restaurant_billing: "uuid, uuid", release_restaurant_billing: "uuid, uuid",
    record_restaurant_billing: "uuid, uuid, jsonb", takeover_restaurant_billing: "uuid, uuid, uuid, timestamptz, jsonb",
  };
  for (const [name, args] of Object.entries(signatures)) {
    expect(schema).toContain(`revoke all on function public.${name}(${args}) from public, anon, authenticated;`);
    expect(schema).toContain(`grant execute on function public.${name}(${args}) to service_role;`);
    expect(functionSql(name)).toContain("security definer set search_path = public");
  }
});
