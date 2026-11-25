import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashMemberToken, MEMBER_COOKIE } from "@/lib/table-member-cookie";

const orderId = "00000000-0000-4000-8000-000000000001";
const paymentId = "00000000-0000-4000-8000-00000000000a";
const dinerToken = "a".repeat(43);
const otherToken = "b".repeat(43);

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, errorTable: "", staff: vi.fn(), limit: vi.fn(), mail: vi.fn(), reads: [] as string[] }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: state.staff }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false, isRateLimited: state.limit }));
vi.mock("@/lib/mail", () => ({ mailConfigured: () => true, sendMail: state.mail }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  state.reads.push(table);
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  let offset = 0;
  const answer = (single = false) => {
    const rows = (state.tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(offset);
    return state.errorTable === table ? { data: null, error: { message: "timeout" } } : { data: single ? rows[0] ?? null : rows, error: null };
  };
  const q = { select: () => q, update: () => q,
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
    is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return q; },
    overlaps: (key: string, values: unknown[]) => { filters.push(row => ((row[key] ?? []) as unknown[]).some(v => values.includes(v))); return q; },
    range: (start: number) => { offset = start; return q; }, order: () => q, single: async () => answer(true), maybeSingle: async () => answer(true),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve) };
  return q;
} }) }));
import { POST } from "@/app/api/receipt/route";
const request = (body: object, token: string | null = dinerToken) => POST(new NextRequest("http://localhost/api/receipt", {
  method: "POST", body: JSON.stringify(body), headers: token ? { cookie: `${MEMBER_COOKIE}=${token}` } : {},
}));
const adjustment = { id: "adjustment", restaurant_id: "r", order_id: orderId, kind: "forgive", previous_total: 120,
  resulting_total: 80, forgiven: 40, previous_tip: 10, resulting_tip: 5, previous_service_fee: 10, resulting_service_fee: 5, currency: "MXN" };

beforeEach(() => {
  state.reads.length = 0; state.errorTable = ""; state.mail.mockReset().mockResolvedValue({ sent: true });
  state.staff.mockReset().mockResolvedValue(null);
  state.limit.mockReset().mockResolvedValue(false);
  state.tables = {
    orders: [{ id: orderId, restaurant_id: "r", table_id: "table", session_id: "session", diner: "owner", paid: true, items: [{ name: "Dinner", price: 100, qty: 1 }],
      subtotal: 100, total: 80, service_fee: 5, tip: 5, currency: "MXN", created_at: "2026-10-27T18:00:00Z" }],
    restaurants: [{ id: "r", name: "Bistro", timezone: "America/Mexico_City" }],
    order_adjustments: [adjustment],
    table_sessions: [{ id: "session", table_id: "table", restaurant_id: "r", closed_at: "2026-10-28T13:00:00Z" }],
    table_session_members: [
      { id: "owner", status: "approved", session_id: "session", token_hash: hashMemberToken(dinerToken) },
      { id: "other", status: "approved", session_id: "session", token_hash: hashMemberToken(otherToken) },
    ],
  };
});

describe("forgiveness on the diner's receipt", () => {
  it.each(["print", "email"])("shows the original bill, original service and tip, forgiveness and paid amount in %s", async delivery => {
    const response = await request({ orderId, ...(delivery === "print" ? { delivery } : { email: "diner@example.com" }) });
    expect(response.status).toBe(200);
    const result = await response.json();
    const html = delivery === "print" ? result.html : state.mail.mock.calls[0][0].html;
    expect(html).toContain("Forgiven by the restaurant");
    expect(html).toContain("MX$120.00"); expect(html).toContain("−MX$40.00"); expect(html).toContain("MX$80.00");
    expect(html).toContain("MX$10.00");
    expect(result.version).toEqual({ adjustmentIds: ["adjustment"] });
  });

  it("reprints the issued original version after the restaurant forgives the rest", async () => {
    // Issued while paid: an unpaid order is never emailed as a receipt (journey A, finding 3).
    const original = { ...state.tables.orders[0], paid: true, total: 120, service_fee: 10, tip: 10 };
    state.tables.orders = [original]; state.tables.order_adjustments = [];
    const issued = await (await request({ orderId, email: "diner@example.com" })).json();
    const originalHtml = state.mail.mock.calls[0][0].html;
    expect(issued.version).toEqual({ adjustmentIds: [] });
    state.tables.orders = [{ ...original, paid: true, total: 80, service_fee: 5, tip: 5 }]; state.tables.order_adjustments = [adjustment];
    const reprint = await (await request({ orderId, delivery: "print", version: issued.version })).json();
    expect(reprint.html).toContain(originalHtml);
    expect(reprint.html).not.toContain("Forgiven by the restaurant");
    expect(reprint.version).toEqual(issued.version);
  });

  it("does not turn an unread adjustment into a receipt with unexplained missing money", async () => {
    state.errorTable = "order_adjustments";
    expect((await request({ orderId, delivery: "print" })).status).toBe(503);
  });
});

describe("a receipt for the parts actually paid", () => {
  beforeEach(() => {
    state.tables.orders[0].paid = false;
    state.tables.payments = [{ id: paymentId, restaurant_id: "r", session_id: "session", stripe_payment_intent: "pi_paid", amount: 58, tip: 8,
      currency: "USD", created_at: "2026-10-28T12:00:00Z" }];
    state.tables.bill_split_slots = [0, 2].map(share_no => ({ restaurant_id: "r", split_id: "split", payment_id: paymentId, share_no, amount_cents: 2600 }));
    state.tables.bill_splits = [{ id: "split", restaurant_id: "r", session_id: "session", table_id: "table", currency: "USD", model_version: 2 }];
    state.tables.diner_checkouts = [{ restaurant_id: "r", stripe_payment_intent: "pi_paid", split_id: "split", payer_member_id: "owner" }];
  });
  it.each(["print", "email"])("uses the payment's parts, full tip including old gratuities and actual charge in %s before the bill is paid", async delivery => {
    const response = await request({ paymentId, ...(delivery === "print" ? { delivery } : { email: "diner@example.com" }) });
    expect(response.status).toBe(200);
    const html = delivery === "print" ? (await response.json()).html : state.mail.mock.calls[0][0].html;
    expect(html).toContain("Parts 1, 3"); expect(html).toContain("$50.00"); expect(html).toContain("$8.00"); expect(html).toContain("$58.00");
    expect(html).not.toContain("Dinner"); expect(html).not.toContain("MX$"); expect(state.reads).not.toContain("orders");
  });

  it("allows only the recorded split payer or the restaurant's staff", async () => {
    expect((await request({ paymentId, delivery: "print" }, otherToken)).status).toBe(403);
    expect(state.limit).not.toHaveBeenCalled();
    expect((await request({ paymentId: `{${paymentId.toUpperCase()}}`, delivery: "print" })).status).toBe(200);
    expect(state.limit).toHaveBeenCalledWith(`receipt-print:${paymentId}`, 20, 86_400);
    state.staff.mockResolvedValue({ restaurantId: "r" });
    expect((await request({ paymentId, delivery: "print" }, null)).status).toBe(200);
  });
});

it("refuses another approved diner and cross-restaurant staff before spending the order quota", async () => {
  state.staff.mockResolvedValue({ restaurantId: "unrelated" });
  expect((await request({ orderId, email: "diner@example.com" }, otherToken)).status).toBe(403);
  expect((await request({ orderId, delivery: "print" }, null)).status).toBe(403);
  expect(state.limit).not.toHaveBeenCalled();
  expect(state.mail).not.toHaveBeenCalled();
});

it("lets staff of the order's restaurant send the receipt without a diner cookie", async () => {
  state.staff.mockResolvedValue({ restaurantId: "r", role: "waiter" });
  expect((await request({ orderId, email: "diner@example.com" }, null)).status).toBe(200);
  expect(state.mail).toHaveBeenCalledOnce();
});

it("allows the diner whose whole-bill card payment covered somebody else's order", async () => {
  state.tables.payments = [{ order_id: orderId, restaurant_id: "r", session_id: "session", stripe_payment_intent: "pi_bill" }];
  state.tables.diner_checkouts = [{ restaurant_id: "r", stripe_payment_intent: "pi_bill", split_id: null, payer_member_id: "other" }];
  expect((await request({ orderId, delivery: "print" }, otherToken)).status).toBe(200);
});

it("checks every order in a batch before sending any receipt", async () => {
  const otherId = "00000000-0000-4000-8000-000000000002";
  state.tables.orders.push({ ...state.tables.orders[0], id: otherId, diner: "other" });
  expect((await request({ orderIds: [orderId, otherId], email: "diner@example.com" })).status).toBe(403);
  expect(state.mail).not.toHaveBeenCalled();
  expect(state.limit).not.toHaveBeenCalled();
});

it("does not accept an unknown or duplicated receipt version", async () => {
  for (const adjustmentIds of [["unknown"], ["adjustment", "adjustment"]]) {
    expect((await request({ orderId, delivery: "print", version: { adjustmentIds } })).status).toBe(404);
  }
});
it("refuses an inconsistent adjustment instead of issuing money that does not add up", async () => {
  state.tables.order_adjustments = [{ ...adjustment, resulting_total: 79 }];
  expect((await request({ orderId, delivery: "print" })).status).toBe(503);
});
it("does not read another restaurant's forgiveness", async () => {
  state.tables.order_adjustments.push({ ...adjustment, id: "other", restaurant_id: "other" });
  const response = await request({ orderId, delivery: "print" });
  expect(response.status).toBe(200); expect((await response.json()).version).toEqual({ adjustmentIds: ["adjustment"] });
});
it.each(["payments", "bill_split_slots", "bill_splits"])("reports a failed %s read without issuing a payment receipt", async table => {
  state.tables.payments = [{ id: paymentId, restaurant_id: "r", session_id: "session", amount: 55, tip: 5, currency: "MXN" }];
  state.tables.bill_split_slots = [{ payment_id: paymentId, restaurant_id: "r", split_id: "split", share_no: 0, amount_cents: 5000 }];
  state.errorTable = table;
  expect((await request({ paymentId, delivery: "print" })).status).toBe(503);
});
it("refuses a payment whose paid parts point outside its restaurant", async () => {
  state.tables.payments = [{ id: paymentId, restaurant_id: "r", session_id: "session", amount: 55, tip: 5, currency: "MXN" }];
  state.tables.bill_split_slots = [{ payment_id: paymentId, restaurant_id: "other", split_id: "split", share_no: 0, amount_cents: 5000 }];
  state.tables.bill_splits = [{ id: "split", restaurant_id: "other", session_id: "session", model_version: 2, currency: "MXN" }];
  expect((await request({ paymentId, delivery: "print" })).status).toBe(404);
});
it("keeps an unscaled original 1.005 and its one-cent forgiveness consistent with PostgreSQL", async () => {
  Object.assign(state.tables.orders[0], { subtotal: "1.005", total: 1, service_fee: 0, tip: 0 });
  state.tables.order_adjustments = [{ ...adjustment, previous_total: "1.005", resulting_total: 1, forgiven: 0.01,
    previous_service_fee: 0, resulting_service_fee: 0, previous_tip: 0, resulting_tip: 0 }];
  const response = await request({ orderId, delivery: "print" });
  expect(response.status).toBe(200); const { html } = await response.json();
  expect(html).toContain("MX$1.01"); expect(html).toContain("−MX$0.01"); expect(html).toContain("MX$1.00");
});
