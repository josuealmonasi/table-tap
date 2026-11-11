import { beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { returnFixture, type Row } from "./returns-contract-fixtures";
import { reportDiscounts } from "@/lib/report-discounts";

const since = "2026-11-10T06:00:00Z", until = "2026-11-11T06:00:00Z";
let f: ReturnType<typeof returnFixture>;
const order = (over: Row = {}) => ({ id: "sale", restaurant_id: "r1", currency: "MXN", status: "received",
  discount: 60, coupon_code: "SAVE", promo_detail: { item: 10, promos: 20, coupon: 30 }, created_at: since, ...over });
const redemption = (over: Row = {}) => ({ id: "use", restaurant_id: "r1", order_id: "sale", amount: 30,
  confirmed_at: since, ...over });
const read = () => reportDiscounts({ from: f.from } as never, "r1", "MXN", since, until);
beforeEach(() => { f = returnFixture(); f.tables.orders = []; f.tables.coupon_redemptions = []; });

it("counts checkout item, product and coupon savings once with or without its redemption", async () => {
  f.tables.orders = [order()];
  expect(await read()).toBe(60);
  f.tables.coupon_redemptions = [redemption()];
  expect(await read()).toBe(60);
});

it("counts one multi-order staff grant, keeping the original product promotion separate", async () => {
  f.tables.orders = [order({ id: "first", promo_detail: { item: 10, promos: 20, coupon: 0 }, discount: 30.01 }),
    order({ id: "second", promo_detail: null, discount: 0.01 })];
  f.tables.coupon_redemptions = [redemption({ order_id: "first", amount: 0.02 })];
  expect(await read()).toBe(30.02);
  // Staff changed old orders today: their original savings remain on their sale day.
  f.tables.orders.forEach(o => { o.created_at = "2026-11-09T06:00:00Z"; });
  expect(await read()).toBe(0.02);
});

it("excludes pending/abandoned checkout savings and unknown, foreign or unconfirmed grants", async () => {
  f.tables.orders = [order({ status: "pending_payment" }), order({ id: "cancel", status: "cancelled" }),
    order({ id: "usd", currency: "USD", promo_detail: null }), order({ id: "other", restaurant_id: "r2", promo_detail: null }),
    order({ id: "staff", promo_detail: null, created_at: "2026-11-09T06:00:00Z" })];
  f.tables.coupon_redemptions = [redemption({ confirmed_at: null }), redemption({ order_id: "usd" }),
    redemption({ order_id: "other", restaurant_id: "r2" }), redemption({ order_id: null }),
    redemption({ order_id: "staff", confirmed_at: null })];
  expect(await read()).toBe(0);
});

it("uses an exclusive end at local midnight and preserves offline discounts without a breakdown", async () => {
  f.tables.orders = [order({ coupon_code: null, promo_detail: null, discount: 0.01 }), order({ id: "next", created_at: until })];
  f.tables.coupon_redemptions = [redemption({ confirmed_at: until })];
  expect(await read()).toBe(0.01);
});

it("pages and chunks all discounts rather than truncating a busy day", async () => {
  f.tables.orders = Array.from({ length: 151 }, (_, i) => order({ id: `sale-${i}`, promo_detail: null,
    discount: 0.01, created_at: "2026-11-09T06:00:00Z" }));
  f.tables.coupon_redemptions = f.tables.orders.map(o => redemption({ order_id: o.id, amount: 0.01 }));
  expect(await read()).toBe(1.51);
});

it("refuses to publish a partial discount total when durable evidence cannot be read", async () => {
  f.from.mockImplementation(() => ({ select() { throw new Error("discount read failed"); } }) as never);
  await expect(read()).rejects.toThrow("discount read failed");
});

it("staff grants and checkout store the evidence in the same SQL transaction as the order changes", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  for (const name of ["apply_bill_discount", "approve_discount_request_v2", "create_order_intent"]) {
    const start = schema.indexOf(`create or replace function public.${name}(`);
    const body = schema.slice(start, schema.indexOf("$$;", start));
    expect(body, name).toContain("insert into coupon_redemptions");
    expect(body, name).toMatch(/(?:update orders|insert into orders)/);
  }
});


it("keeps a card checkout accepted after midnight on its acceptance day", async () => {
  f.tables.orders = [order({ created_at: "2026-11-10T05:59:00Z", checkout_discount_at: since })];
  // A delayed or missing best-effort redemption cannot lose this coupon.
  expect(await read()).toBe(60);
});


it("keeps accepted checkout savings after a later cancellation without changing drawer lines", async () => {
  f.tables.orders = [order({ checkout_discount_at: since, status: "cancelled" })];
  expect(await read()).toBe(60);
});

it("stamps acceptance inside the order transaction and keeps the date immutable with drop parity", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.indexOf("create or replace function public.stamp_checkout_discount_v1()");
  const body = schema.slice(start, schema.indexOf("$$;", start));
  expect(schema).toContain("add column if not exists checkout_discount_at timestamptz default null");
  expect(body).toContain("then new.created_at else null end");
  expect(body).toContain("old.status = 'pending_payment' and new.status not in ('pending_payment', 'cancelled')");
  expect(body).toContain("new.checkout_discount_at := clock_timestamp()");
  expect(body).toContain("new.checkout_discount_at := old.checkout_discount_at");
  expect(schema).toContain("before insert or update on orders");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.stamp_checkout_discount_v1()");
});
