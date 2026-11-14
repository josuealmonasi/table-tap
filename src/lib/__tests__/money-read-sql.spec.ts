import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const definitions = [...schema.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\$\$;/g)];
const definition = (name: string, signature: string) => definitions
  .filter(m => m[1] === name && m[2].startsWith(signature)).at(-1)?.[0] ?? "";

it("batches exactly the per-id SQL progress fields within the restaurant", () => {
  const sql = definition("refund_operations_progress_v1", "p_restaurant uuid, p_ids uuid[])");
  expect(sql).toContain("returns table (operation_id uuid, outstanding_cents int, unresolved boolean)");
  expect(sql).toContain("jsonb_to_record(public.refund_operation_progress_v1(o.id))");
  expect(sql).toContain("as progress(outstanding_cents int, unresolved boolean)");
  expect(sql).toContain("o.restaurant_id = p_restaurant and o.id = any(p_ids)");
  expect(sql).not.toContain("refund_attempts");
  expect(sql).not.toContain("round(");
});

it("filters window candidates before evidence aggregation and events before deduplication", () => {
  const sql = definition("order_return_events_v1", "p_restaurant uuid, p_currency text, p_from timestamptz, p_to timestamptz)");
  expect(sql).not.toBe("");
  const candidates = sql.slice(0, sql.indexOf("v_refunds :="));
  expect(candidates).toContain("o.completed_at >= p_from and o.completed_at < p_to");
  expect(candidates).toContain("coalesce(a.succeeded_at, o.completed_at) >= p_from");
  expect(candidates).toContain("coalesce(a.succeeded_at, o.completed_at) < p_to");
  expect(candidates).toContain("or a.succeeded_at is null");
  const guards = sql.slice(sql.indexOf("if exists"), sql.indexOf("return query"));
  expect(guards).toContain("a.operation_id = any(v_operations)");
  expect(guards).toContain("a.stripe_refund_id = any(v_refunds)");
  expect(guards).toContain("o.stripe_refund_id = any(v_refunds)");
  for (const reason of ["a succeeded refund has no success time", "a provider refund is counted by two returns",
    "two records of one refund disagree", "a completed return does not reconcile with its refunds"]) {
    expect(guards).toContain(`raise exception '${reason}'`);
  }
  const queries = sql.split("return query").slice(1);
  expect(queries).toHaveLength(2);
  expect(queries[0]).toMatch(/where[\s\S]*coalesce\(a.succeeded_at, o.completed_at\) >= p_from[\s\S]*coalesce\(a.succeeded_at, o.completed_at\) < p_to[\s\S]*order by/);
  expect(queries[1]).toMatch(/where[\s\S]*o.completed_at >= p_from and o.completed_at < p_to/);
  expect(definition("order_return_events_v1", "p_restaurant uuid, p_currency text default null)")).not.toBe("");
});

it.each(["refund_operations_progress_v1(uuid, uuid[])", "order_return_events_v1(uuid, text, timestamptz, timestamptz)"])(
  "%s is restricted to service_role and removed on reset", signature => {
    const name = signature.split("(")[0];
    const sql = definitions.filter(m => m[1] === name).at(-1)?.[0] ?? "";
    expect(sql).toContain("stable security definer set search_path = public");
    expect(schema.includes(`revoke all on function public.${signature} from public, anon, authenticated;`)).toBe(true);
    expect(schema.includes(`grant execute on function public.${signature} to service_role;`)).toBe(true);
    expect(drop).toContain(`drop function if exists public.${signature};`);
  },
);
