import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Writing off the rest of a part-paid bill (design agreed with Codex in
// tabletap-release/loop/dialogue, topic writeoff). Replayed on dev Postgres in
// a rolled-back transaction; these pin the rules.
const sql = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const body = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];
const fn = "write_off_remainder_v1(uuid, uuid[], int, text, text, text, text, uuid, uuid)";

it("runs under the money lock and is callable by the server only", () => {
  expect(body("write_off_remainder_v1")).toContain("perform public.lock_restaurant_money(p_restaurant);");
  expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
  expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
  expect(drop).toContain(`drop function if exists public.${fn};`);
});

it("forgives only what part-paid orders still owe, writes unpaid ones off whole, and never while money could still arrive", () => {
  const f = body("write_off_remainder_v1");
  expect(f).toContain("if o.covered <= 0 then v_whole := v_whole + round(o.total * 100)::int;");
  expect(f).toContain("update orders set written_off = true, write_off_reason = p_reason");
  expect(f).toContain("if v_owed + v_whole <> p_expected_cents then");
  // Odd cents: a fully covered order is settled, never given a zero forgiveness (audit #4).
  expect(f).toContain("if v_rest <= 0 then");
  for (const refusal of ["'unresolved'", "'paying'", "'split'"]) expect(f).toContain(refusal);
  // The order ends at what was paid, paid and completed: completed does not restock.
  expect(f).toContain("update orders set total = round(o.covered, 2), tip = v_tip, service_fee = v_service, paid = true, status = 'completed'");
});

it("the guard lets through only the change its own adjustment records", () => {
  const guard = body("guard_allocated_order");
  expect(guard).toContain("a.id::text = current_setting('tabletap.forgive_writer', true)");
  expect(guard).toContain("a.previous_total = old.total and a.resulting_total = new.total");
  expect(guard).toContain("new.total = v_covered and new.paid and not new.written_off");
});

it("the forgiveness is an immutable record, one per order per operation", () => {
  expect(sql).toContain("check (kind in ('cancel', 'forgive', 'return'))");
  expect(sql).toContain("round(previous_total - resulting_total, 2) = forgiven");
  expect(sql).toContain("for each row when (old.kind = 'forgive') execute function public.guard_order_adjustment();");
  expect(sql).toContain("create unique index if not exists order_adjustments_forgive_once");
});

it("write-off audit #1 and #2: a request is decided under its lock first, and the loss is written with the change", () => {
  const f = body("write_off_remainder_v1");
  expect(f.indexOf("from write_off_requests where id = p_request")).toBeLessThan(f.indexOf("update orders set"));
  expect(f).toContain("if not found or v_request.status <> 'pending' then return jsonb_build_object('outcome', 'gone')");
  expect(f).toContain("insert into user_logs (id, restaurant_id, actor_email, entity, action, detail)");
  expect(f).toContain("'currency=' || p_currency");
});

it("write-off audit #7: the record refuses a delete except as part of a cascade", () => {
  expect(sql).toContain("create trigger guard_order_adjustment before update or delete on order_adjustments");
  expect(body("guard_order_adjustment")).toContain("if pg_trigger_depth() > 1 then return old; end if;");
});
