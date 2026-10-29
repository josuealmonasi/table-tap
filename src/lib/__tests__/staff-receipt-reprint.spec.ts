import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ role: "cashier", locale: "en" as "en" | "es", errorTable: "", tables: {} as Record<string, Record<string, unknown>[]>, reads: [] as string[] }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => state.role === "none" ? null : { restaurantId: "r", role: state.role },
  actingFrontOfHouse: async () => !["kitchen", "none"].includes(state.role) ? { restaurantId: "r", role: state.role } : null }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => state.locale }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  state.reads.push(table); let offset = 0; const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const answer = (single = false) => {
    const rows = (state.tables[table] ?? []).filter(row => filters.every(f => f(row))).slice(offset);
    return state.errorTable === table ? { data: null, error: { message: "timeout" } } : { data: single ? rows[0] ?? null : rows, error: null };
  };
  const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; }, range: (start: number) => { offset = start; return q; }, order: () => q,
    maybeSingle: async () => answer(true), then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve) };
  return q;
} }) }));
import { POST } from "@/app/api/orders/print/route";
const request = (body: object) => POST(new NextRequest("http://localhost/api/orders/print", { method: "POST", body: JSON.stringify({ to: "receipt", ...body }) }));
beforeEach(() => {
  state.role = "cashier"; state.locale = "en"; state.errorTable = ""; state.reads = [];
  state.tables = {
    orders: [{ id: "order", restaurant_id: "r", table_id: "table", paid: true, items: [{ name: "Dinner", price: 100, qty: 1 }], subtotal: 100, total: 80, service_fee: 5, tip: 5, currency: "MXN", created_at: "2026-10-28T12:00:00Z" }],
    order_adjustments: [{ id: "loss", order_id: "order", restaurant_id: "r", kind: "forgive", currency: "MXN", previous_total: 120, resulting_total: 80, forgiven: 40, previous_tip: 10, resulting_tip: 5, previous_service_fee: 10, resulting_service_fee: 5 }],
    restaurants: [{ id: "r", name: "Bistro", timezone: "America/Mexico_City" }],
    payments: [{ id: "payment", restaurant_id: "r", session_id: "session", amount: 58, tip: 8, currency: "USD", created_at: "2026-10-28T12:00:00Z" }],
    bill_split_slots: [0, 2].map(share_no => ({ restaurant_id: "r", split_id: "split", payment_id: "payment", share_no, amount_cents: 2600 })),
    bill_splits: [{ id: "split", restaurant_id: "r", table_id: "table", session_id: "session", model_version: 2, currency: "USD" }],
  };
});
it.each([["en", "Forgiven by the restaurant"], ["es", "Perdonado por el restaurante"]] as const)("reprints forgiveness with its original and paid amounts (%s)", async (locale, label) => {
  state.locale = locale;
  const response = await request({ orderId: "order" }); expect(response.status).toBe(200);
  const { html, version } = await response.json(); expect(html).toContain(label); expect(html).toContain("MX$120.00");
  expect(html).toContain("−MX$40.00"); expect(html).toContain("MX$80.00"); expect(version).toEqual({ adjustmentIds: ["loss"] });
});
it.each([["en", "Parts 1, 3"], ["es", "Partes 1, 3"]] as const)("reprints a payment while the rest of the table is unpaid (%s)", async (locale, label) => {
  state.locale = locale; state.tables.orders[0].paid = false;
  const response = await request({ paymentId: "payment" }); expect(response.status).toBe(200);
  const { html } = await response.json(); expect(html).toContain(label); expect(html).toContain("$50.00");
  expect(html).toContain("$8.00"); expect(html).toContain("$58.00"); expect(html).not.toContain("Dinner"); expect(state.reads).not.toContain("orders");
});
it("keeps the issued original version on a later staff reprint", async () => {
  const response = await request({ orderId: "order", version: { adjustmentIds: [] } }); expect(response.status).toBe(200);
  const { html, version } = await response.json(); expect(html).not.toContain("Forgiven by the restaurant");
  expect(html).toContain("MX$120.00"); expect(version).toEqual({ adjustmentIds: [] });
});
it.each(["kitchen", "none"])("refuses %s before reading financial rows", async role => {
  state.role = role; expect((await request({ paymentId: "payment" })).status).toBe(403); expect(state.reads).toEqual([]);
});
it.each(["orderId", "paymentId"])("refuses another restaurant's %s", async key => {
  state.tables.orders[0].restaurant_id = "other"; state.tables.payments[0].restaurant_id = "other";
  expect((await request({ [key]: key === "orderId" ? "order" : "payment" })).status).toBe(404);
});
it.each(["order_adjustments", "payments", "bill_split_slots"])("issues no receipt on a failed %s read", async table => {
  state.errorTable = table;
  expect((await request(table === "order_adjustments" ? { orderId: "order" } : { paymentId: "payment" })).status).toBe(503);
});
it("rejects ambiguous identities and payment-based kitchen requests", async () => {
  expect((await request({ orderId: "order", paymentId: "payment" })).status).toBe(400);
  expect((await request({ to: "kitchen", paymentId: "payment" })).status).toBe(400);
});
