import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

/**
 * Two diner ordering defects (2026-11-26), held to the SQL that fixes them.
 *
 * 1. A phone let in because its first order would be paid by card kept that
 *    approval when the card page was abandoned, and then sent unlimited
 *    pay-later orders to the kitchen.
 * 2. A diner's order could be written onto a sitting the cashier had just
 *    closed: neither writer held the sitting.
 */
const read = (path: string): string => readFileSync(path, "utf8");
const schema = read("supabase/schema.sql");
const drop = read("supabase/drop.sql");
const fn = (name: string): string => {
  const start = schema.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf("$$;", schema.indexOf("$$", start) + 2));
};

describe("defect 1: only a vouched-for phone puts food on the bill", () => {
  it("marks only the phone that opened the sitting unaided as auto-approved", () => {
    expect(schema).toContain("alter table table_session_members add column if not exists auto_approved boolean not null default false;");
    const v4 = fn("request_table_member_v4");
    expect(v4).toContain("insert into table_session_members(session_id, token_hash, status, decided_at, seen_at, auto_approved)");
    expect(v4).toContain("now(), v_created and p_first_approved)");
    expect(read("src/lib/table-membership.ts")).toContain('rpc("request_table_member_v4"');
  });

  it("lets a phone admitted by an unvouched phone inherit the flag, and staff clear it", () => {
    const v2 = fn("decide_table_member_v2");
    expect(v2).toContain("select auto_approved into v_unvouched from table_session_members");
    expect(v2).toContain("auto_approved = coalesce(v_unvouched, false)");
    expect(read("src/app/api/table-membership/route.ts")).toContain('rpc("decide_table_member_v2"');
  });

  it("refuses an unvouched phone until the sitting has a paid order, and caps the sitting at 15", () => {
    const refusal = fn("diner_pay_later_refusal_v1");
    expect(refusal).toMatch(/auto_approved\)\s+and not exists \(select 1 from orders where restaurant_id = p_restaurant and session_id = p_session\s+and paid and status <> 'cancelled'\) then 'payLaterNeedsStaff'/);
    expect(refusal).toMatch(/diner is not null and not paid and not written_off[\s\S]*>= 15 then 'sittingPayLaterFull'/);
    expect(refusal).toContain("status = 'approved') then 'notMember'");
  });

  it("judges pay-later in both diner writers and never a card order", () => {
    const intent = fn("create_diner_order_intent_v1");
    expect(intent.indexOf("diner_pay_later_refusal_v1")).toBeGreaterThan(intent.indexOf("for share;"));
    const plain = fn("create_diner_order_v1");
    expect(plain).toMatch(/if p_deferred then\s+v_refusal := public\.diner_pay_later_refusal_v1/);
    // The ceiling is counted under the restaurant's money lock.
    expect(plain).toContain("if p_deferred then perform public.lock_restaurant_money(p_restaurant); end if;");
    expect(intent.indexOf("lock_restaurant_money")).toBeLessThan(intent.indexOf("diner_pay_later_refusal_v1"));
  });
});

describe("defect 2: a diner's order needs an open sitting", () => {
  it("holds the sitting FOR SHARE before either writer inserts", () => {
    for (const writer of ["create_diner_order_intent_v1", "create_diner_order_v1"]) {
      const body = fn(writer);
      expect(body, writer).toContain("closed_at is null\n   for share;");
      expect(body, writer).toContain(`if not found then return '{"sittingClosed":true}'::jsonb; end if;`);
      expect(body.indexOf("for share;"), writer).toBeLessThan(body.search(/insert into orders|create_order_intent\(/));
    }
  });

  it("answers a replay before the sitting, as the waiter's writer does", () => {
    const intent = fn("create_diner_order_intent_v1");
    expect(intent.indexOf("order_intent_result")).toBeLessThan(intent.indexOf("for share;"));
    // The coupon goes with it: the waiter's writer passes null.
    expect(intent).toContain("p_threshold, p_coupon);");
  });

  it("routes a diner's table order through the locked writers", () => {
    expect(read("src/lib/order-intent.ts")).toContain('rpc("create_diner_order_intent_v1"');
    expect(read("src/lib/checkout/diner-order.ts")).toContain('rpc("create_diner_order_v1"');
    expect(read("src/app/api/checkout/route.ts")).toContain("dinerMember: sessionId && member ? member : undefined");
  });
});

it("keeps the deployed signatures and drops only the new ones", () => {
  for (const kept of ["request_table_member_v3", "decide_table_member", "create_order_intent", "create_table_order_intent_v2"]) {
    expect(schema).toContain(`create or replace function public.${kept}(`);
  }
  for (const line of [
    "drop function if exists public.create_diner_order_v1(uuid, jsonb, uuid, boolean);",
    "drop function if exists public.create_diner_order_intent_v1(uuid, uuid, text, jsonb, jsonb, boolean, int, jsonb, uuid);",
    "drop function if exists public.diner_pay_later_refusal_v1(uuid, uuid, uuid);",
    "drop function if exists public.decide_table_member_v2(uuid, uuid, uuid, boolean, text, text);",
    "drop function if exists public.request_table_member_v4(uuid, uuid, text, boolean, boolean);",
    "alter table if exists table_session_members drop column if exists auto_approved;",
  ]) expect(drop).toContain(line);
  for (const name of ["request_table_member_v4", "decide_table_member_v2", "diner_pay_later_refusal_v1",
    "create_diner_order_intent_v1", "create_diner_order_v1"]) {
    expect(schema).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
  }
});

it("says each refusal in both languages", () => {
  for (const key of ["tableBillClosedScan", "payLaterNeedsStaff", "tablePayLaterFull"] as const) {
    expect(es.apiErr[key], key).toBeTruthy();
    expect(en.apiErr[key], key).toBeTruthy();
    expect(es.apiErr[key]).not.toBe(en.apiErr[key]);
  }
});
