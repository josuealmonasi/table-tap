import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";
import { printableReceipt } from "@/lib/print-document";
import { messagesFor, translate } from "@/lib/i18n";
const orderId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], readError: null as { message: string } | null, writes: vi.fn(), mail: vi.fn(), limited: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r" }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false, isRateLimited: state.limited }));
vi.mock("@/lib/mail", () => ({ mailConfigured: () => true, sendMail: state.mail }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let offset = 0;
  let orders = state.rows;
  const q = { range: (start: number) => { offset = start; return q; }, select: () => q, in: (field: string, ids: string[]) => {
    if (table === "orders" && field === "id") orders = orders.filter(row => ids.includes(String(row.id)));
    return q;
  }, eq: () => q, update: (data: unknown) => { state.writes(data); return q; },
    order: () => q, single: async () => ({ data: { name: "Bistro", timezone: "America/Mexico_City" } }) };
  Object.assign(q, { then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "orders" ? orders.slice(offset) : [], error: state.readError }).then(resolve) });
  return q;
} }) }));
import { POST } from "@/app/api/receipt/route";
const order = (id: string, extra: object = {}) => ({ id, restaurant_id: "r", table_id: "table", items: [{ itemId: "dish", name: "<Dish>", price: 100, qty: 1, mods: {} }], subtotal: 80, discount: 20, service_fee: 5, tip: 10, total: 95, currency: "USD", paid: true, created_at: "2026-10-27T12:00:00Z", ...extra });
const request = (body: object) => POST(new NextRequest("http://localhost/api/receipt", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { state.rows = [order(orderId(1)), order(orderId(2))]; state.readError = null; state.writes.mockClear(); state.mail.mockReset().mockResolvedValue({ sent: true }); state.limited.mockReset().mockResolvedValue(false); });
it("prints the exact shared receipt HTML, including a table's discounts, tips and original currency, without mail or writes", async () => {
  const res = await request({ orderIds: [orderId(1), orderId(2)], delivery: "print" }); expect(res.status).toBe(200);
  const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars);
  const receipt = buildReceipt(state.rows as unknown as ReceiptOrder[], { name: "Bistro", timeZone: "America/Mexico_City", locale: "en-US" }, t);
  expect(await res.json()).toEqual({ html: printableReceipt(receipt.html, receipt.subject), version: { adjustmentIds: [] } });
  expect(state.mail).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
});
it("keeps emailed receipts on the existing renderer and timestamps successful mail only", async () => {
  expect((await request({ orderIds: [orderId(1), orderId(2)], email: "diner@example.com" })).status).toBe(200);
  expect(state.mail).toHaveBeenCalledOnce(); expect(state.mail.mock.calls[0][0].html).toContain("&lt;Dish&gt;");
  expect(state.writes).toHaveBeenCalledOnce();
});
it.each([{ paid: false }, { currency: "MXN" }, { restaurant_id: "other" }, { table_id: "other-table" }])("refuses to combine mismatched printed receipts: %j", async extra => {
  state.rows[1] = order(orderId(2), extra);
  expect((await request({ orderIds: [orderId(1), orderId(2)], delivery: "print" })).status).toBe(404);
  expect(state.mail).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
});
it("does not print a partial or empty read", async () => {
  state.rows = [state.rows[0]];
  expect((await request({ orderIds: [orderId(1), orderId(2)], delivery: "print" })).status).toBe(404);
  state.rows = []; expect((await request({ orderIds: [orderId(1)], delivery: "print" })).status).toBe(404);
});
it("rate limits printing independently from the email resend allowance", async () => {
  state.limited.mockResolvedValue(true);
  expect((await request({ orderIds: [orderId(1)], delivery: "print" })).status).toBe(429);
  expect(state.limited.mock.calls[0][0]).toBe(`receipt-print:${orderId(1)}`); expect(state.mail).not.toHaveBeenCalled();
});
it("paths #8: never emails pesos and dollars added up as one total", async () => {
  state.rows[1] = order(orderId(2), { currency: "MXN" });
  expect((await request({ orderIds: [orderId(1), orderId(2)], email: "diner@example.com" })).status).toBe(404);
  expect(state.mail).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
});
it("a failed order read is an error, not a missing order", async () => {
  state.readError = { message: "timeout" };
  expect((await request({ orderIds: [orderId(1)], email: "diner@example.com" })).status).toBe(503);
  expect(state.mail).not.toHaveBeenCalled();
});
it("emails all 41 orders of a long sitting, never the first 40 as the whole bill (sweep 4, finding 2)", async () => {
  state.rows = Array.from({ length: 41 }, (_, i) => order(orderId(i), { total: 10, tip: 0, service_fee: 0, subtotal: 10, discount: 0 }));
  expect((await request({ orderIds: state.rows.map(o => o.id), email: "diner@example.com" })).status).toBe(200);
  expect(state.mail.mock.calls[0][0].html).toContain("410.00");
  expect((await request({ orderIds: state.rows.map(o => o.id), delivery: "print" })).status).toBe(200);
});
it("refuses a receipt over the cap instead of cutting it short", async () => {
  const ids = Array.from({ length: 101 }, (_, i) => orderId(i));
  const res = await request({ orderIds: ids, email: "diner@example.com" });
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "receipt.tooManyOrders" });
  expect(state.mail).not.toHaveBeenCalled();
});
it("never emails an unpaid order as a receipt (journey A, finding 3)", async () => {
  state.rows = [order(orderId(1), { paid: false })];
  expect((await request({ orderIds: [orderId(1)], email: "diner@example.com" })).status).toBe(404);
  expect(state.mail).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
});

it("counts equivalent UUID spellings once against the canonical email quota", async () => {
  const id = orderId(171);
  state.rows = [order(id)];
  const aliases = [id, `{${id.toUpperCase()}}`, id.replaceAll("-", "")];
  const response = await request({ orderIds: aliases, email: "diner@example.com" });
  expect(response.status).toBe(200);
  expect(state.limited.mock.calls).toEqual([[`receipt-order:${id}`, 4, 86_400]]);
  expect(state.mail).toHaveBeenCalledOnce();
  expect(state.writes).toHaveBeenCalledOnce();
});

it.each([
  { orderIds: [orderId(1), "invalid"] },
  { orderIds: [orderId(1), 42] },
  { paymentId: "{malformed}" },
])("rejects malformed IDs without using the receipt quota: %j", async ids => {
  expect((await request({ ...ids, delivery: "print" })).status).toBe(400);
  expect(state.limited).not.toHaveBeenCalled();
});
