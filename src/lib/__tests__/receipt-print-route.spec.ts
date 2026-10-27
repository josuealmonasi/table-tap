import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";
import { printableReceipt } from "@/lib/print-document";
import { messagesFor, translate } from "@/lib/i18n";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], writes: vi.fn(), mail: vi.fn(), limited: vi.fn() }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false, isRateLimited: state.limited }));
vi.mock("@/lib/mail", () => ({ mailConfigured: () => true, sendMail: state.mail }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q = { select: () => q, in: () => q, eq: () => q, update: (data: unknown) => { state.writes(data); return q; },
    order: async () => ({ data: state.rows }), single: async () => ({ data: { name: "Bistro", timezone: "America/Mexico_City" } }) };
  void table; return q;
} }) }));
import { POST } from "@/app/api/receipt/route";
const order = (id: string, extra: object = {}) => ({ id, restaurant_id: "r", table_id: "table", items: [{ itemId: "dish", name: "<Dish>", price: 100, qty: 1, mods: {} }], subtotal: 80, discount: 20, service_fee: 5, tip: 10, total: 95, currency: "USD", paid: true, created_at: "2026-10-27T12:00:00Z", ...extra });
const request = (body: object) => POST(new NextRequest("http://localhost/api/receipt", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { state.rows = [order("1111-order"), order("2222-order")]; state.writes.mockClear(); state.mail.mockReset().mockResolvedValue({ sent: true }); state.limited.mockReset().mockResolvedValue(false); });
it("prints the exact shared receipt HTML, including a table's discounts, tips and original currency, without mail or writes", async () => {
  const res = await request({ orderIds: ["1111-order", "2222-order"], delivery: "print" }); expect(res.status).toBe(200);
  const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars);
  const receipt = buildReceipt(state.rows as unknown as ReceiptOrder[], { name: "Bistro", timeZone: "America/Mexico_City", locale: "en-US" }, t);
  expect(await res.json()).toEqual({ html: printableReceipt(receipt.html, receipt.subject) });
  expect(state.mail).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
});
it("keeps emailed receipts on the existing renderer and timestamps successful mail only", async () => {
  expect((await request({ orderIds: ["1111-order", "2222-order"], email: "diner@example.com" })).status).toBe(200);
  expect(state.mail).toHaveBeenCalledOnce(); expect(state.mail.mock.calls[0][0].html).toContain("&lt;Dish&gt;");
  expect(state.writes).toHaveBeenCalledOnce();
});
it.each([{ paid: false }, { currency: "MXN" }, { restaurant_id: "other" }, { table_id: "other-table" }])("refuses to combine mismatched printed receipts: %j", async extra => {
  state.rows[1] = order("2222-order", extra);
  expect((await request({ orderIds: ["1111-order", "2222-order"], delivery: "print" })).status).toBe(404);
  expect(state.mail).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
});
it("does not print a partial or empty read", async () => {
  state.rows = [state.rows[0]];
  expect((await request({ orderIds: ["1111-order", "2222-order"], delivery: "print" })).status).toBe(404);
  state.rows = []; expect((await request({ orderIds: ["1111-order"], delivery: "print" })).status).toBe(404);
});
it("rate limits printing independently from the email resend allowance", async () => {
  state.limited.mockResolvedValue(true);
  expect((await request({ orderIds: ["1111-order"], delivery: "print" })).status).toBe(429);
  expect(state.limited.mock.calls[0][0]).toBe("receipt-print:1111-order"); expect(state.mail).not.toHaveBeenCalled();
});
