import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The SQL half of paths audit #7 (contract agreed with Codex in
// tabletap-release/loop/dialogue, topic refund7). Replayed on dev Postgres:
// manual MX$40 counted once, remainder capped at 50, nothing new while an
// attempt is unknown, completion at 100. These pin the rules.
const sql = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const body = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];

it("both functions run under the money lock and are callable by the server only", () => {
  for (const fn of ["record_refund_due_coverage_v1(uuid, uuid, text, jsonb)", "start_refund_due_attempt_v2(uuid, uuid, int)"]) {
    const name = fn.split("(")[0];
    expect(body(name), name).toContain("perform public.lock_restaurant_money(p_restaurant);");
    expect(sql, name).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
    expect(sql, name).toContain(`grant execute on function public.${fn} to service_role;`);
    expect(drop, name).toContain(`drop function if exists public.${fn};`);
  }
});

it("a manual refund is coverage, never a change to our own attempt", () => {
  const record = body("record_refund_due_coverage_v1");
  expect(record).not.toContain("update refund_due_attempts");
  expect(record).toContain("values (p_restaurant, d.id, null, e->>'id'");
  expect(record).toContain("on conflict (due_id, stripe_refund_id) do update set active = refund_due_coverage.active and excluded.active");
});

it("a replacement is capped at what is refundable, and never opens while the latest is in flight", () => {
  const start = body("start_refund_due_attempt_v2");
  expect(start).toContain("v_send := least(v_due - v_covered, p_refundable_cents);");
  expect(start).toContain("a.provider_status in ('failed', 'canceled')");
  expect(start).toContain("'outcome', 'none'");
  expect(start).not.toMatch(/update refund_due_attempts set amount/);
});
