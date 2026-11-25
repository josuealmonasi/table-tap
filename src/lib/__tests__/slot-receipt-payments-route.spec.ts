import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ member: vi.fn(), limited: false, errorTable: "", tables: {} as Record<string, Record<string, unknown>[]>, reads: [] as string[] }));
vi.mock("@/lib/table-membership", () => ({ tableMember: state.member }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "room", forTheRoom: (n: number) => n, isRateLimited: async () => state.limited }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  state.reads.push(table); const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; }, order: () => q,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(state.errorTable === table ? { data: null, error: {} }
      : { data: (state.tables[table] ?? []).filter(row => filters.every(f => f(row))), error: null }).then(resolve) };
  return q;
} }) }));
import { GET } from "@/app/api/receipt/payments/route";
const request = () => GET(new NextRequest("http://localhost/api/receipt/payments?restaurantId=r&tableId=table&sessionId=session"));
beforeEach(() => {
  state.reads = []; state.errorTable = ""; state.limited = false; state.member.mockReset().mockResolvedValue({ id: "member", closed: true });
  state.tables = {
    bill_splits: [{ id: "split", restaurant_id: "r", table_id: "table", session_id: "session", model_version: 2, status: "locked", order_ids: ["order"] }],
    bill_split_slots: [0, 2].map(share_no => ({ restaurant_id: "r", split_id: "split", share_no, payment_id: "payment", reserved_checkout_id: "secret-checkout" })),
    payments: [{ id: "payment", restaurant_id: "r", session_id: "session", stripe_payment_intent: "pi_own" }],
    diner_checkouts: [{ restaurant_id: "r", stripe_payment_intent: "pi_own", payer_member_id: "member", split_id: "split" }],
    orders: ["order", "split-order"].map(id => ({ id, restaurant_id: "r", session_id: "session", diner: "member" })),
  };
});
it("groups only the approved sitting's paid parts, including after its last payment", async () => {
  state.tables.bill_splits.push({ id: "other", restaurant_id: "r", table_id: "table", session_id: "next-party", model_version: 2 });
  state.tables.bill_split_slots.push({ restaurant_id: "r", split_id: "other", share_no: 1, payment_id: "stranger" },
    { restaurant_id: "other-restaurant", split_id: "split", share_no: 1, payment_id: "foreign" },
    { restaurant_id: "r", split_id: "split", share_no: 3, payment_id: null });
  const response = await request(); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ split: true, splitOrderIds: ["order"], payments: [{ paymentId: "payment", splitId: "split", slots: [0, 2] }] });
  expect(state.member).toHaveBeenCalledWith(expect.any(NextRequest), "r", "table", "session", true);
});
it("withholds another diner's payment ID and unassigned cash receipts", async () => {
  state.tables.bill_split_slots.push(
    { restaurant_id: "r", split_id: "split", share_no: 1, payment_id: "other-payment" },
    { restaurant_id: "r", split_id: "split", share_no: 3, payment_id: "cash" });
  state.tables.payments.push(
    { id: "other-payment", restaurant_id: "r", session_id: "session", stripe_payment_intent: "pi_other" },
    { id: "cash", restaurant_id: "r", session_id: "session", stripe_payment_intent: null });
  state.tables.diner_checkouts.push({ restaurant_id: "r", stripe_payment_intent: "pi_other", payer_member_id: "other", split_id: "split" });
  const body = await (await request()).json();
  expect(body.payments).toEqual([{ paymentId: "payment", splitId: "split", slots: [0, 2] }]);
});
it("still suppresses the ordinary receipt when a cancelled split has another diner's paid parts", async () => {
  state.tables.bill_splits[0].status = "cancelled";
  state.tables.diner_checkouts[0].payer_member_id = "other";
  expect(await (await request()).json()).toEqual({ split: false, splitOrderIds: ["order"], payments: [] });
});
it("refuses an unapproved phone before reading any payment ids", async () => {
  state.member.mockResolvedValue(null); expect((await request()).status).toBe(403); expect(state.reads).toEqual([]);
});
it("rate limits polling before reading the sitting", async () => {
  state.limited = true; expect((await request()).status).toBe(429); expect(state.member).not.toHaveBeenCalled();
});
it.each(["bill_splits", "bill_split_slots", "payments", "diner_checkouts", "orders"])("does not turn a failed %s read into an empty observation", async table => {
  state.errorTable = table; expect((await request()).status).toBe(503);
});
it("does not invent a receipt for an unsplit or legacy bill", async () => {
  state.tables.bill_splits[0].model_version = 1;
  expect(await (await request()).json()).toEqual({ split: false, splitOrderIds: [], payments: [] });
});

it("names the split's orders without labelling a later round as divided", async () => {
  state.tables.bill_splits[0] = { ...state.tables.bill_splits[0], status: "done", order_ids: ["split-order"] };
  const body = await (await request()).json();
  expect(body.splitOrderIds).toEqual(["split-order"]);
  expect(body.split).toBe(false);
  expect(body.payments).toHaveLength(1);
});

it("names only orders this phone placed or paid for, never the rest of a closed split", async () => {
  state.tables.bill_splits[0] = { ...state.tables.bill_splits[0], status: "done", order_ids: ["order", "theirs", "paid-for", "next-party"] };
  state.tables.orders.push(
    { id: "theirs", restaurant_id: "r", session_id: "session", diner: "other" },
    { id: "paid-for", restaurant_id: "r", session_id: "session", diner: "other" },
    { id: "next-party", restaurant_id: "r", session_id: "later", diner: "member" });
  state.tables.payments[0].order_id = "paid-for";
  state.tables.payments.push({ id: "p2", restaurant_id: "r", session_id: "session", order_id: "theirs", stripe_payment_intent: "pi_other" });
  state.tables.bill_split_slots.push({ restaurant_id: "r", split_id: "split", share_no: 1, payment_id: "p2" });
  state.tables.diner_checkouts.push({ restaurant_id: "r", stripe_payment_intent: "pi_other", payer_member_id: "other", split_id: "split" });
  const body = await (await request()).json();
  expect(body.splitOrderIds).toEqual(["order", "paid-for"]);
});
