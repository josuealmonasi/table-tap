import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { depositDays, type DepositRecord } from "@/lib/terminal";
import { terminalReturns } from "@/lib/terminal-returns";
import { expectedOnHand } from "@/lib/costs/stock";

// Terminal deposits, waste reversals and pack sizes (2026-11-25).

const state = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[], error: null as { code: string } | null, reads: 0 }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "restaurant", email: "owner" }) }));
vi.mock("@/lib/costs/guard", async original => ({ ...await original<object>(), costsBlocks: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => { state.calls.push({ name, args }); return { data: state.error ? null : "purchase", error: state.error }; },
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => { state.reads++; return { data: { name: "Milk", pack_size: 2000 }, error: null }; } };
    return q;
  },
}) }));

const { POST } = await import("@/app/api/costs/purchases/route");
const schema = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string) => schema.slice(schema.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];

describe("a payment signed on one day stays on it after a time-zone change", () => {
  // 05:30 UTC on Nov 24: 23:30 on Nov 23 in Mexico City, 00:30 on Nov 24 in Cancún.
  const payment = { id: "p1", amount: 100, tip: 0, created_at: "2026-11-24T05:30:00Z" };
  const signed: DepositRecord = {
    sales_day: "2026-11-23", expected: 100, received: 100, note: null, recorded_by: "manager",
    created_at: "2026-11-24T18:00:00Z", payment_ids: ["p1"], return_ids: [], fee_pct: 0, currency: "MXN",
  };

  it("does not offer the signed MX$100 again on Nov 24 in Cancún", () => {
    const days = depositDays([payment], [signed], 0, 1, "America/Cancun", "2026-11-25");
    expect(days.find(d => d.day === "2026-11-24")).toBeUndefined();
    expect(days.find(d => d.day === "2026-11-23")).toMatchObject({ count: 1, takings: 100, late: 0, status: "received" });
  });

  it("still reads an unsigned payment on the restaurant's current calendar day", () => {
    const days = depositDays([payment], [], 0, 1, "America/Cancun", "2026-11-25");
    expect(days.map(d => d.day)).toEqual(["2026-11-24"]);
  });

  it("dates a void of the signed payment against the signed day", () => {
    const voided = { ...payment, voided_at: "2026-11-24T05:45:00Z" };
    const [ret] = terminalReturns([voided], "America/Cancun", new Map([["p1", "2026-11-23"]]));
    expect(ret).toMatchObject({ saleDay: "2026-11-23", day: "2026-11-24" });
  });

  it("pins the deposit writer's ledger to signed days and refuses a payment another deposit holds", () => {
    const sql = fn("record_terminal_deposit_v1");
    expect(sql.indexOf("marks as materialized")).toBeLessThan(sql.indexOf("ledger as materialized"));
    expect(sql).toMatch(/coalesce\(\(select d\.sales_day from marks d where l\.payment_id = any\(d\.payment_ids\)[\s\S]*?\(l\.created_at at time zone v_zone\)::date\) sale_day/);
    const refuse = sql.indexOf("d.payment_ids && v_payments");
    expect(refuse).toBeGreaterThan(sql.indexOf("into v_expected, v_payments"));
    expect(refuse).toBeLessThan(sql.indexOf("insert into terminal_deposits"));
    expect(sql).toContain("jsonb_build_object('error', 'already_signed')");
  });

  it("answers the writer's refusal with its own copy in both languages", () => {
    const route = readFileSync("src/app/api/terminal/deposits/route.ts", "utf8");
    expect(route).toContain(`data?.error === "already_signed") return await apiError("apiErr.depositPaymentSigned", 409)`);
    for (const lang of ["es", "en"]) expect(readFileSync(`src/lib/i18n/${lang}.ts`, "utf8")).toContain("depositPaymentSigned:");
  });
});

describe("deleting a waste entry from before a count leaves post-count stock alone", () => {
  const counts = new Map([["milk", { ingredient_id: "milk", counted: 1000, created_at: "2026-11-24T10:00:00Z", movement_cutoff: 10 }]]);
  const spill = { id: 5, ingredient_id: "milk", quantity: -200, kind: "waste" as const, created_at: "2026-11-24T09:00:00Z" };

  it("expects the counted 1,000 ml, not 1,200 ml, after the spill is removed", () => {
    const reversal = { id: 12, ingredient_id: "milk", quantity: 200, kind: "waste" as const, created_at: spill.created_at, count_position: 5 };
    expect(expectedOnHand(["milk"], counts, [spill, reversal]).get("milk")).toBe(1000);
  });

  it("still moves stock for a reversal of a movement from after the count", () => {
    const later = { ...spill, id: 11, created_at: "2026-11-24T11:00:00Z" };
    const reversal = { id: 12, ingredient_id: "milk", quantity: 200, kind: "waste" as const, created_at: later.created_at, count_position: 11 };
    expect(expectedOnHand(["milk"], counts, [spill, later, reversal]).get("milk")).toBe(1000);
    expect(expectedOnHand(["milk"], counts, [spill, later]).get("milk")).toBe(800);
  });

  it("carries the record's place in the correction trigger and the blind count", () => {
    expect(schema).toContain("alter table ingredient_movements add column if not exists count_position bigint;");
    expect(schema).toContain("alter table ingredient_consumption add column if not exists movement_position bigint;");
    const trigger = fn("track_ingredient_movement");
    expect(trigger).toContain("if tg_op <> 'INSERT' and v_kind <> 'sale' then");
    expect(trigger).toContain("v_position := coalesce(v_previous.movement_position,");
    expect(trigger).toContain("insert into ingredient_movements(restaurant_id, ingredient_id, quantity, kind, created_at, count_position)");
    expect(trigger).toContain("movement_position = coalesce(ingredient_consumption.movement_position, excluded.movement_position)");
    const count = fn("cutoff_ingredient_count");
    expect(count).toContain("coalesce(count_position, id) <= new.movement_cutoff");
    expect(count).toContain("else coalesce(count_position, id) > v_last.movement_cutoff end");
    expect(readFileSync("src/lib/costs/stock-server.ts", "utf8")).toContain("quantity, kind, created_at, count_position");
  });
});

describe("a pack-size edit during a delivery is refused under the row lock", () => {
  const body = { ingredientId: "00000000-0000-4000-8000-000000000001", packs: 2, total: 100, packSize: 1000 };
  const send = (extra: Record<string, unknown> = {}) =>
    POST(new NextRequest("https://test/api/costs/purchases", { method: "POST", body: JSON.stringify({ ...body, ...extra }) }));
  beforeEach(() => { state.calls = []; state.error = null; state.reads = 0; });

  it("passes the form's pack size to the writer instead of comparing a read taken before it", async () => {
    expect((await send()).status).toBe(200);
    expect(state.calls).toEqual([{ name: "record_purchase_v2", args: expect.objectContaining({ p_pack_size: 1000, p_packs: 2 }) }]);
    // Only the activity log's name lookup, after the write: no pack-size read before it.
    expect(state.reads).toBe(1);
    state.reads = 0;
    await send({ ref: body.ingredientId });
    expect(state.reads).toBe(0);
    expect(state.calls[1]).toMatchObject({ name: "record_purchase_once_v3", args: { p_pack_size: 1000, p_ref: body.ingredientId } });
  });

  it("answers the writer's mismatch with the reload copy", async () => {
    state.error = { code: "PT412" };
    const response = await send();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "apiErr.purchasePackChanged" });
    expect(readFileSync("src/lib/i18n/es.ts", "utf8")).toMatch(/purchasePackChanged: "[^"]*Recarga la página/);
    expect(readFileSync("src/lib/i18n/en.ts", "utf8")).toMatch(/purchasePackChanged: "[^"]*Reload the page/);
  });

  it("sends a retry to the writer even without a pack size, so a saved one is answered", async () => {
    expect((await send({ packSize: undefined })).status).toBe(409);
    expect(state.calls).toEqual([]);
    expect((await send({ packSize: undefined, ref: body.ingredientId })).status).toBe(200);
    expect(state.calls[0]).toMatchObject({ name: "record_purchase_once_v3", args: { p_pack_size: null } });
  });

  it("compares under the ingredient row lock, after resolving a saved retry", () => {
    for (const name of ["record_purchase_v2", "record_purchase_once_v3"]) {
      const sql = fn(name);
      const lock = sql.indexOf("for update");
      expect(sql.indexOf("perform public.lock_ingredient_movements"), name).toBeLessThan(lock);
      expect(sql.indexOf("v_size is distinct from p_pack_size"), name).toBeGreaterThan(lock);
      expect(sql).toContain("errcode = 'PT412'");
    }
    const retry = fn("record_purchase_once_v3");
    expect(retry.indexOf("request_ref = p_ref")).toBeLessThan(retry.indexOf("for update"));
    const drop = readFileSync("supabase/drop.sql", "utf8");
    expect(drop).toContain("drop function if exists public.record_purchase_v2(uuid, uuid, numeric, numeric, text, numeric);");
    expect(drop).toContain("drop function if exists public.record_purchase_once_v3(uuid, uuid, numeric, numeric, text, uuid, numeric);");
  });
});
