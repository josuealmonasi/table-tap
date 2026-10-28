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
    bill_splits: [{ id: "split", restaurant_id: "r", table_id: "table", session_id: "session", model_version: 2 }],
    bill_split_slots: [0, 2].map(share_no => ({ restaurant_id: "r", split_id: "split", share_no, payment_id: "payment", reserved_checkout_id: "secret-checkout" })),
  };
});
it("groups only the approved sitting's paid parts, including after its last payment", async () => {
  state.tables.bill_splits.push({ id: "other", restaurant_id: "r", table_id: "table", session_id: "next-party", model_version: 2 });
  state.tables.bill_split_slots.push({ restaurant_id: "r", split_id: "other", share_no: 1, payment_id: "stranger" },
    { restaurant_id: "other-restaurant", split_id: "split", share_no: 1, payment_id: "foreign" },
    { restaurant_id: "r", split_id: "split", share_no: 3, payment_id: null });
  const response = await request(); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ split: true, payments: [{ paymentId: "payment", splitId: "split", slots: [0, 2] }] });
  expect(state.member).toHaveBeenCalledWith(expect.any(NextRequest), "r", "table", "session", true);
  expect(state.reads).not.toContain("payments");
});
it("refuses an unapproved phone before reading any payment ids", async () => {
  state.member.mockResolvedValue(null); expect((await request()).status).toBe(403); expect(state.reads).toEqual([]);
});
it("rate limits polling before reading the sitting", async () => {
  state.limited = true; expect((await request()).status).toBe(429); expect(state.member).not.toHaveBeenCalled();
});
it.each(["bill_splits", "bill_split_slots"])("does not turn a failed %s read into an empty observation", async table => {
  state.errorTable = table; expect((await request()).status).toBe(503);
});
it("does not invent a receipt for an unsplit or legacy bill", async () => {
  state.tables.bill_splits[0].model_version = 1;
  expect(await (await request()).json()).toEqual({ split: false, payments: [] });
});
